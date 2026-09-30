import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { Clock } from '../../src/common/clock/clock.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { MISSION_QUEUE_NAME } from '../../src/jobs/queues.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer, type SeededPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

interface AuthPair {
  seeded: SeededPlayer;
  token: string;
  shipId: string;
}

interface MarketListingBody {
  locationId: string;
  listings: Array<{
    listingId: string;
    kind: string;
    partType: string;
    price: number;
    condition: number;
  }>;
  sellOffers: Array<{ partInstanceId: string; price: number }>;
}

// S8.2 acceptance (plan line 469): buy = validate + debit + deliver in one transaction;
// expectedPrice is only a stale-price guard (409 PRICE_CHANGED); idempotent; blocked while
// balance is negative (GDD §14); used offers per D25; ship must be at the board's port.
describe('market API (S8.2)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let configService: GameConfigService;
  let queue: Queue;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    configService = testApp.app.get(GameConfigService);
    queue = testApp.app.get(getQueueToken(MISSION_QUEUE_NAME));
  });

  afterAll(async () => {
    await queue.obliterate({ force: true }).catch(() => undefined);
    await testApp?.close();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
    await queue.obliterate({ force: true }).catch(() => undefined);
  });

  async function freshSeededApp(): Promise<void> {
    await resetDatabase(prisma);
    await seed(prisma);
    await configService.refresh();
  }

  async function onboardPlayer(): Promise<AuthPair> {
    const passwords = testApp.app.get(PasswordService);
    const tokens = testApp.app.get(TokenService);
    const seeded = await seedAccountWithPlayer(prisma, passwords);
    const token = await tokens.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const onboarded = await request(httpServer(testApp.app))
      .post('/v1/players/me/onboarding')
      .set(auth(token))
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    await assembleStarterKit(httpServer(testApp.app), token, (onboarded.body as { id: string }).id);
    return { seeded, token, shipId: (onboarded.body as { id: string }).id };
  }

  const auth = (token: string): { Authorization: string } => ({
    Authorization: `Bearer ${token}`,
  });

  function getMarket(token: string, locationId: string) {
    return request(httpServer(testApp.app))
      .get(`/v1/locations/${locationId}/market`)
      .set(auth(token));
  }

  function buy(token: string, key: string | undefined, body: Record<string, unknown>) {
    const req = request(httpServer(testApp.app)).post('/v1/market/buy').set(auth(token));
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req.send(body);
  }

  function sell(token: string, key: string | undefined, body: Record<string, unknown>) {
    const req = request(httpServer(testApp.app)).post('/v1/market/sell').set(auth(token));
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req.send(body);
  }

  it('GET market at the ship port lists catalog and used offers', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();

    const response = await getMarket(player.token, 'ceres');
    expect(response.status).toBe(200);
    const body = response.body as MarketListingBody;
    expect(body.locationId).toBe('ceres');
    const catalog = body.listings.filter((entry) => entry.kind === 'catalog');
    const used = body.listings.filter((entry) => entry.kind === 'used');
    expect(catalog.length).toBeGreaterThan(0);
    expect(used.length).toBeGreaterThan(0);
    for (const listing of body.listings) {
      // S8.1 review: wallet moves are positive integers — nothing is ever free (a0-base
      // bridge rounds to 1¢) and nothing is ever worthless.
      expect(listing.price).toBeGreaterThanOrEqual(1);
    }
  });

  it('GET market and buy reject 409 SHIP_NOT_AT_LOCATION when the ship is elsewhere', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await prisma.ship.update({
      where: { id: player.shipId },
      data: { currentLocationId: 'hedus' },
    });

    const board = await getMarket(player.token, 'ceres');
    expect(board.status).toBe(409);
    expect(board.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_NOT_AT_LOCATION' },
    });

    const buyResponse = await buy(player.token, randomUUID(), {
      listingId: 'catalog:ceres:hull',
      expectedPrice: 1,
    });
    expect(buyResponse.status).toBe(409);
    expect(buyResponse.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_NOT_AT_LOCATION' },
    });
  });

  it('buy debits wallet and delivers the part; PRICE_CHANGED is only a stale-price guard', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const board = await getMarket(player.token, 'ceres');
    const listing = (board.body as MarketListingBody).listings.find(
      (entry) => entry.kind === 'catalog' && entry.partType === 'hull',
    );
    expect(listing).toBeDefined();

    const stale = await buy(player.token, randomUUID(), {
      listingId: listing!.listingId,
      expectedPrice: listing!.price + 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      statusCode: 409,
      message: { error: 'PRICE_CHANGED' },
    });

    const before = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });
    const ok = await buy(player.token, randomUUID(), {
      listingId: listing!.listingId,
      expectedPrice: listing!.price,
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ partType: 'hull', price: listing!.price });
    const after = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });
    expect(after.credits).toBe(before.credits - listing!.price);
    const instance = await prisma.partInstance.findUniqueOrThrow({
      where: { id: (ok.body as { partInstanceId: string }).partInstanceId },
    });
    expect(instance.location).toBe('INVENTORY');
    expect(instance.ownerPlayerId).toBe(player.seeded.player.id);
  });

  it('buy is idempotent: missing key 400, same key+body replays once', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const board = await getMarket(player.token, 'ceres');
    const listing = (board.body as MarketListingBody).listings.find(
      (entry) => entry.kind === 'catalog' && entry.partType === 'cargo',
    );
    expect(listing).toBeDefined();

    const noKey = await buy(player.token, undefined, {
      listingId: listing!.listingId,
      expectedPrice: listing!.price,
    });
    expect(noKey.status).toBe(400);

    const key = randomUUID();
    const first = await buy(player.token, key, {
      listingId: listing!.listingId,
      expectedPrice: listing!.price,
    });
    const second = await buy(player.token, key, {
      listingId: listing!.listingId,
      expectedPrice: listing!.price,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.text).toBe(first.text);
    const parts = await prisma.partInstance.count({
      where: { ownerPlayerId: player.seeded.player.id, partType: 'cargo', location: 'INVENTORY' },
    });
    expect(parts).toBe(1);
  });

  it('buy is blocked while the balance is already negative (GDD §14)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const board = await getMarket(player.token, 'ceres');
    const listing = (board.body as MarketListingBody).listings.find(
      (entry) => entry.kind === 'catalog' && entry.partType === 'hull',
    );
    expect(listing).toBeDefined();
    await prisma.player.update({
      where: { id: player.seeded.player.id },
      data: { credits: -50 },
    });

    const response = await buy(player.token, randomUUID(), {
      listingId: listing!.listingId,
      expectedPrice: listing!.price,
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'BALANCE_NEGATIVE' },
    });
  });

  it('buy rejects INSUFFICIENT_FUNDS when the price exceeds the balance', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await prisma.player.update({
      where: { id: player.seeded.player.id },
      data: { credits: 1 },
    });
    const board = await getMarket(player.token, 'ceres');
    const listing = (board.body as MarketListingBody).listings.find(
      (entry) => entry.kind === 'catalog' && entry.price > 1,
    );
    expect(listing).toBeDefined();

    const response = await buy(player.token, randomUUID(), {
      listingId: listing!.listingId,
      expectedPrice: listing!.price,
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'INSUFFICIENT_FUNDS' },
    });
  });

  it('used offer buy delivers the listed part at the listed condition', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const board = await getMarket(player.token, 'ceres');
    const used = (board.body as MarketListingBody).listings.find((entry) => entry.kind === 'used');
    expect(used).toBeDefined();
    // Used-offer prices roll by calendar day (D25) and can exceed the onboarding
    // grant (start_credits=200); this test is about delivery, so fund exactly.
    await prisma.player.update({
      where: { id: player.seeded.player.id },
      data: { credits: used!.price },
    });

    const response = await buy(player.token, randomUUID(), {
      listingId: used!.listingId,
      expectedPrice: used!.price,
    });
    // On a failure, show what the server said (a bare "409 vs 200" once hid the cause in CI).
    expect({
      status: response.status,
      body: response.body as unknown,
      listing: used,
    }).toMatchObject({
      status: 200,
    });
    expect(response.body).toMatchObject({
      partType: used!.partType,
      condition: used!.condition,
      price: used!.price,
    });
  });

  it('a used part is one item: after it is bought it leaves the shelf and cannot be bought again', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const board = await getMarket(player.token, 'ceres');
    const used = (board.body as MarketListingBody).listings.find((entry) => entry.kind === 'used')!;
    await prisma.player.update({
      where: { id: player.seeded.player.id },
      data: { credits: used.price * 3 },
    });

    const first = await buy(player.token, randomUUID(), {
      listingId: used.listingId,
      expectedPrice: used.price,
    });
    expect(first.status).toBe(200);

    const again = await buy(player.token, randomUUID(), {
      listingId: used.listingId,
      expectedPrice: used.price,
    });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ message: { error: 'LISTING_SOLD' } });

    const after = await getMarket(player.token, 'ceres');
    const ids = (after.body as MarketListingBody).listings.map((entry) => entry.listingId);
    expect(ids).not.toContain(used.listingId);
    // New parts are a different story: the port restocks them (D25), so they stay for sale.
    expect((after.body as MarketListingBody).listings.some((e) => e.kind === 'catalog')).toBe(true);
    // Exactly one part was created and paid for.
    await expect(
      prisma.partInstance.count({
        where: { ownerPlayerId: player.seeded.player.id, partType: used.partType },
      }),
    ).resolves.toBeGreaterThanOrEqual(1);
    const bought = await prisma.playerEvent.count({
      where: {
        type: 'market.buy',
        payload: { path: ['listingId'], equals: used.listingId },
      },
    });
    expect(bought).toBe(1);
  });

  it('a part below the sell threshold gets no quote and cannot be sold; discard destroys it (W5)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const playerId = player.seeded.player.id;
    const wreck = await prisma.partInstance.create({
      data: { partType: 'cargo', ownerPlayerId: playerId, condition: 9, location: 'INVENTORY' },
    });
    const worn = await prisma.partInstance.create({
      data: { partType: 'cargo', ownerPlayerId: playerId, condition: 40, location: 'INVENTORY' },
    });

    const board = (await getMarket(player.token, 'ceres')).body as {
      sellOffers: Array<{ partInstanceId: string }>;
      sellMinCondition: number;
    };
    expect(board.sellMinCondition).toBe(15);
    const quoted = board.sellOffers.map((offer) => offer.partInstanceId);
    expect(quoted).not.toContain(wreck.id);
    expect(quoted).toContain(worn.id);

    const refused = await sell(player.token, randomUUID(), {
      partInstanceId: wreck.id,
      expectedPrice: 0,
    });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ message: { error: 'TOO_DAMAGED_TO_SELL' } });
    expect(await prisma.partInstance.findUnique({ where: { id: wreck.id } })).not.toBeNull();

    // Discard destroys exactly the too-damaged parts that are in storage; nothing installed.
    const installedBefore = await prisma.partInstance.count({
      where: { ownerPlayerId: playerId, location: 'INSTALLED' },
    });
    const discarded = await request(httpServer(testApp.app))
      .post('/v1/inventory/discard')
      .set(auth(player.token));
    expect(discarded.status).toBe(200);
    expect(discarded.body).toEqual({ discarded: 1 });
    expect(await prisma.partInstance.findUnique({ where: { id: wreck.id } })).toBeNull();
    expect(await prisma.partInstance.findUnique({ where: { id: worn.id } })).not.toBeNull();
    expect(
      await prisma.partInstance.count({
        where: { ownerPlayerId: playerId, location: 'INSTALLED' },
      }),
    ).toBe(installedBefore);
    // Naturally idempotent.
    const again = await request(httpServer(testApp.app))
      .post('/v1/inventory/discard')
      .set(auth(player.token));
    expect(again.body).toEqual({ discarded: 0 });
  });

  it('parallel buys cannot overspend: exactly floor(balance/price) succeed', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const board = await getMarket(player.token, 'ceres');
    const listing = (board.body as MarketListingBody).listings.find(
      (entry) => entry.kind === 'catalog' && entry.partType === 'hull',
    );
    expect(listing).toBeDefined();
    const price = listing!.price;
    expect(price).toBeGreaterThan(0);

    // Balance buys exactly two: the conditional debit (credits >= price) must let
    // two through and reject the rest, however the requests interleave.
    await prisma.player.update({
      where: { id: player.seeded.player.id },
      data: { credits: price * 2 },
    });

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        buy(player.token, randomUUID(), {
          listingId: listing!.listingId,
          expectedPrice: price,
        }),
      ),
    );
    const succeeded = responses.filter((response) => response.status === 200);
    const rejected = responses.filter((response) => response.status === 409);
    expect(succeeded).toHaveLength(2);
    expect(rejected).toHaveLength(4);
    for (const response of rejected) {
      expect(response.body).toMatchObject({
        statusCode: 409,
        message: { error: 'INSUFFICIENT_FUNDS' },
      });
    }

    const after = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });
    expect(after.credits).toBe(0);
    const parts = await prisma.partInstance.count({
      where: { ownerPlayerId: player.seeded.player.id, partType: 'hull', location: 'INVENTORY' },
    });
    expect(parts).toBe(2);
  });

  it('parallel sells of the same part credit once; losers 404, never 500 (review item 7)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const board = await getMarket(player.token, 'ceres');
    const listing = (board.body as MarketListingBody).listings.find(
      (entry) => entry.kind === 'catalog' && entry.partType === 'cargo',
    );
    expect(listing).toBeDefined();
    const bought = await buy(player.token, randomUUID(), {
      listingId: listing!.listingId,
      expectedPrice: listing!.price,
    });
    expect(bought.status).toBe(200);
    const partInstanceId = (bought.body as { partInstanceId: string }).partInstanceId;
    const before = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });

    // Learn the real sell price from a stale-price guard, then race five distinct keys
    // (same key would replay) at the same partInstance.
    const stale = await sell(player.token, randomUUID(), {
      partInstanceId,
      expectedPrice: listing!.price + 1,
    });
    expect(stale.status).toBe(409);
    const actual = (stale.body as { message: { actual: number } }).message.actual;

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        sell(player.token, randomUUID(), { partInstanceId, expectedPrice: actual }),
      ),
    );
    const succeeded = responses.filter((response) => response.status === 200);
    const gone = responses.filter((response) => response.status === 404);
    expect(succeeded).toHaveLength(1);
    expect(gone).toHaveLength(4);
    for (const response of gone) {
      expect(response.body).toMatchObject({ statusCode: 404 });
    }

    const after = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });
    expect(after.credits).toBe(before.credits + actual);
    await expect(
      prisma.partInstance.findUnique({ where: { id: partInstanceId } }),
    ).resolves.toBeNull();
  });

  it('a 0-base part moves exactly 1¢ each way — never free, never worthless (review item 1)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const board = await getMarket(player.token, 'ceres');
    const bridge = (board.body as MarketListingBody).listings.find(
      (entry) => entry.kind === 'catalog' && entry.partType === 'bridge',
    );
    expect(bridge).toBeDefined();
    expect(bridge!.price).toBe(1);

    const before = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });
    const bought = await buy(player.token, randomUUID(), {
      listingId: bridge!.listingId,
      expectedPrice: 1,
    });
    expect(bought.status).toBe(200);
    const partInstanceId = (bought.body as { partInstanceId: string }).partInstanceId;
    const afterBuy = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });
    expect(afterBuy.credits).toBe(before.credits - 1);

    const stale = await sell(player.token, randomUUID(), { partInstanceId, expectedPrice: 2 });
    expect(stale.status).toBe(409);
    const actual = (stale.body as { message: { actual: number } }).message.actual;
    expect(actual).toBe(1);
    const sold = await sell(player.token, randomUUID(), { partInstanceId, expectedPrice: actual });
    expect(sold.status).toBe(200);
    const afterSell = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });
    expect(afterSell.credits).toBe(before.credits);
  });

  it('rejects stale or forged used listing ids with 400 INVALID_LISTING (review item 3)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    for (const listingId of [
      `used:ceres:${yesterday}:0:hull`,
      `used:ceres:${today}:6:hull`,
      `used:ceres:${today}:99:hull`,
      `used:ceres:${today}:999999999999999999999999:hull`,
    ]) {
      const response = await buy(player.token, randomUUID(), { listingId, expectedPrice: 1 });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        statusCode: 400,
        message: { error: 'INVALID_LISTING' },
      });
    }
  });

  it('sell credits the player; PRICE_CHANGED guards stale prices; idempotent', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    // Starter parts are all installed — buy a spare so sell has an inventory row.
    const board = await getMarket(player.token, 'ceres');
    const listing = (board.body as MarketListingBody).listings.find(
      (entry) => entry.kind === 'catalog' && entry.partType === 'cargo',
    );
    expect(listing).toBeDefined();
    const bought = await buy(player.token, randomUUID(), {
      listingId: listing!.listingId,
      expectedPrice: listing!.price,
    });
    expect(bought.status).toBe(200);
    const partInstanceId = (bought.body as { partInstanceId: string }).partInstanceId;

    const before = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });

    const stale = await sell(player.token, randomUUID(), {
      partInstanceId,
      expectedPrice: listing!.price + 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      statusCode: 409,
      message: { error: 'PRICE_CHANGED' },
    });

    const actual = (stale.body as { message: { actual: number } }).message.actual;
    const key = randomUUID();
    const first = await sell(player.token, key, {
      partInstanceId,
      expectedPrice: actual,
    });
    const second = await sell(player.token, key, {
      partInstanceId,
      expectedPrice: actual,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.text).toBe(first.text);
    const after = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });
    expect(after.credits).toBe(before.credits + actual);
    await expect(
      prisma.partInstance.findUnique({ where: { id: partInstanceId } }),
    ).resolves.toBeNull();
  });

  it('the board quotes what the port pays for each inventory part, and sell accepts that quote first try (S10.9)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const board = await getMarket(player.token, 'ceres');
    expect((board.body as MarketListingBody).sellOffers).toEqual([]);

    const listing = (board.body as MarketListingBody).listings.find(
      (entry) => entry.kind === 'catalog' && entry.partType === 'cargo',
    )!;
    const bought = await buy(player.token, randomUUID(), {
      listingId: listing.listingId,
      expectedPrice: listing.price,
    });
    const partInstanceId = (bought.body as { partInstanceId: string }).partInstanceId;

    const after = await getMarket(player.token, 'ceres');
    const offers = (after.body as MarketListingBody).sellOffers;
    expect(offers).toHaveLength(1);
    expect(offers[0]!.partInstanceId).toBe(partInstanceId);

    // The quote is exactly what sell expects: no PRICE_CHANGED round trip.
    const sold = await sell(player.token, randomUUID(), {
      partInstanceId,
      expectedPrice: offers[0]!.price,
    });
    expect(sold.status).toBe(200);
    expect((sold.body as { price: number }).price).toBe(offers[0]!.price);
  });

  it('the shelf follows the injected clock: a listing from another day is refused (T0.7)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const clock = testApp.app.get(Clock);
    const at = jest.spyOn(clock, 'now');
    try {
      at.mockReturnValue(new Date('2026-03-10T12:00:00Z'));
      const board = await getMarket(player.token, 'ceres');
      const used = (board.body as MarketListingBody).listings.find(
        (entry) => entry.kind === 'used',
      )!;
      expect(used.listingId).toContain(':2026-03-10:');

      // Same instant: the listing is buyable at its listed price.
      await prisma.player.update({
        where: { id: player.seeded.player.id },
        data: { credits: used.price },
      });
      const bought = await buy(player.token, randomUUID(), {
        listingId: used.listingId,
        expectedPrice: used.price,
      });
      expect({ status: bought.status, body: bought.body as unknown }).toMatchObject({
        status: 200,
      });

      // Next UTC day: yesterday's listing id no longer exists.
      at.mockReturnValue(new Date('2026-03-11T00:00:01Z'));
      const stale = await buy(player.token, randomUUID(), {
        listingId: used.listingId,
        expectedPrice: used.price,
      });
      expect(stale.status).toBe(400);
      expect(stale.body).toMatchObject({ message: { error: 'INVALID_LISTING' } });

      // ...and the board now lists the new day's shelf.
      const next = await getMarket(player.token, 'ceres');
      const fresh = (next.body as MarketListingBody).listings.find(
        (entry) => entry.kind === 'used',
      )!;
      expect(fresh.listingId).toContain(':2026-03-11:');
    } finally {
      at.mockRestore();
    }
  });

  describe('rarity-gated new-parts shelf (round-5 backlog: scarce rare/epic, no legendary)', () => {
    it('never lists a LEGENDARY catalog part (chance 0 by default)', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();

      const legendaryRows = await prisma.partCatalog.findMany({
        where: { active: true, rarity: 'LEGENDARY' },
        select: { partType: true },
      });
      expect(legendaryRows.length).toBeGreaterThan(0);

      const board = await getMarket(player.token, 'ceres');
      const catalogListings = (board.body as MarketListingBody).listings.filter(
        (entry) => entry.kind === 'catalog',
      );
      const listedLegendary = catalogListings.filter((entry) =>
        legendaryRows.some((row) => row.partType === entry.partType),
      );
      expect(listedLegendary).toHaveLength(0);
    });

    it('always lists every COMMON catalog part (chance 1 by default)', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();

      const commonRows = await prisma.partCatalog.findMany({
        where: { active: true, rarity: 'COMMON' },
        select: { partType: true },
      });
      expect(commonRows.length).toBeGreaterThan(0);

      const board = await getMarket(player.token, 'ceres');
      const listedTypes = new Set(
        (board.body as MarketListingBody).listings
          .filter((entry) => entry.kind === 'catalog')
          .map((entry) => entry.partType),
      );
      for (const row of commonRows) {
        expect(listedTypes.has(row.partType)).toBe(true);
      }
    });

    it('rejects buying a LEGENDARY part even with a hand-built catalog listing id', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      await prisma.player.update({
        where: { id: player.seeded.player.id },
        data: { credits: 1_000_000 },
      });

      const legendary = await prisma.partCatalog.findFirstOrThrow({
        where: { active: true, rarity: 'LEGENDARY' },
      });

      const response = await buy(player.token, randomUUID(), {
        listingId: `catalog:ceres:${legendary.partType}`,
        expectedPrice: legendary.basePrice,
      });
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ message: { error: 'INVALID_LISTING' } });
    });
  });
});
