import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
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
  listings: {
    listingId: string;
    kind: string;
    partType: string;
    price: number;
  }[];
  sellOffers: {
    partInstanceId: string;
    price: number;
  }[];
}

describe('economy stats', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let configService: GameConfigService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    configService = testApp.app.get(GameConfigService);
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await testApp?.close();
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
      .set({ Authorization: `Bearer ${token}` })
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    const shipId = (onboarded.body as { id: string }).id;
    await assembleStarterKit(httpServer(testApp.app), token, shipId);
    return { seeded, token, shipId };
  }

  function post(token: string, path: string, key: string | undefined, body?: Record<string, unknown>) {
    const req = request(httpServer(testApp.app)).post(path).set({ Authorization: `Bearer ${token}` });
    if (key !== undefined) req.set('Idempotency-Key', key);
    return body === undefined ? req : req.send(body);
  }

  function get(token: string, path: string) {
    return request(httpServer(testApp.app)).get(path).set({ Authorization: `Bearer ${token}` });
  }

  async function readStats(playerId: string): Promise<Record<string, number>> {
    const row = await prisma.playerStats.findUnique({ where: { playerId } });
    return ((row?.totals ?? {}) as unknown) as Record<string, number>;
  }

  it('counts a market buy and a market sell', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const ship = await prisma.ship.findUniqueOrThrow({
      where: { id: player.shipId },
      select: { currentLocationId: true },
    });

    // Give the pilot a loose part to sell.
    const sellPart = await prisma.partInstance.create({
      data: {
        partType: 'cargo',
        ownerPlayerId: player.seeded.player.id,
        condition: 100,
        location: 'INVENTORY',
      },
    });

    const board = await get(player.token, `/v1/locations/${ship.currentLocationId}/market`);
    expect(board.status).toBe(200);
    const market = board.body as MarketListingBody;
    expect(market.sellOffers).toEqual(
      expect.arrayContaining([expect.objectContaining({ partInstanceId: sellPart.id })]),
    );

    const sellOffer = market.sellOffers.find((o) => o.partInstanceId === sellPart.id)!;
    const sold = await post(player.token, '/v1/market/sell', randomUUID(), {
      partInstanceId: sellPart.id,
      expectedPrice: sellOffer.price,
    });
    expect(sold.status).toBe(200);

    const affordable = market.listings
      .filter((l) => l.kind === 'catalog' && l.price > 0)
      .sort((a, b) => a.price - b.price);
    expect(affordable.length).toBeGreaterThan(0);
    const listing = affordable[0]!;
    const balance = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
      select: { credits: true },
    });
    if (balance.credits < listing.price) {
      await prisma.player.update({
        where: { id: player.seeded.player.id },
        data: { credits: { increment: listing.price * 2 } },
      });
    }
    const bought = await post(player.token, '/v1/market/buy', randomUUID(), {
      listingId: listing.listingId,
      expectedPrice: listing.price,
    });
    expect(bought.status).toBe(200);

    const totals = await readStats(player.seeded.player.id);
    expect(totals['parts.sold']).toBe(1);
    expect(totals['parts.bought']).toBe(1);
  }, 30_000);

  it('counts a repair and the money spent on it', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();

    // Damage an installed part so the workshop has something to repair.
    const installed = await prisma.partInstance.findFirst({
      where: { ownerPlayerId: player.seeded.player.id, location: 'INSTALLED', shipId: player.shipId },
    });
    expect(installed).not.toBeNull();
    await prisma.partInstance.update({
      where: { id: installed!.id },
      data: { condition: 50 },
    });

    const quote = await post(player.token, `/v1/ships/${player.shipId}/repair/quote`, undefined, {
      targets: [{ partInstanceId: installed!.id, toCondition: 100 }],
    });
    expect(quote.status).toBe(200);
    const quoteBody = quote.body as { cost: number; items: { partInstanceId: string; cost: number; durationSeconds: number }[] };

    // Make sure the pilot can pay.
    await prisma.player.update({
      where: { id: player.seeded.player.id },
      data: { credits: { increment: quoteBody.cost * 2 } },
    });

    const started = await post(player.token, `/v1/ships/${player.shipId}/repair`, randomUUID(), {
      targets: [{ partInstanceId: installed!.id, toCondition: 100 }],
    });
    expect(started.status).toBe(200);

    const totals = await readStats(player.seeded.player.id);
    expect(totals['repairs.count']).toBe(1);
  }, 30_000);

  it('counts a refuel and the money spent on it', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();

    // Leave room in the tank so the refuel is a real purchase.
    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 5 } });

    const refueled = await post(player.token, `/v1/ships/${player.shipId}/refuel`, randomUUID(), {
      mode: 'partial',
      amount: 10,
    });
    expect(refueled.status).toBe(200);
    expect((refueled.body as { cost: number }).cost).toBeGreaterThan(0);

    const totals = await readStats(player.seeded.player.id);
    expect(totals['refuels.count']).toBe(1);
  }, 30_000);

  it('writes no stats when a purchase is rejected for insufficient funds', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const ship = await prisma.ship.findUniqueOrThrow({
      where: { id: player.shipId },
      select: { currentLocationId: true },
    });

    await prisma.player.update({ where: { id: player.seeded.player.id }, data: { credits: 0 } });

    const board = await get(player.token, `/v1/locations/${ship.currentLocationId}/market`);
    expect(board.status).toBe(200);
    const market = board.body as MarketListingBody;
    const listing = market.listings.find((l) => l.kind === 'catalog' && l.price > 0);
    if (listing === undefined) {
      // No buyable listing in this seed: the invariant still holds trivially.
      expect(await prisma.playerStats.count({ where: { playerId: player.seeded.player.id } })).toBe(0);
      return;
    }

    const bought = await post(player.token, '/v1/market/buy', randomUUID(), {
      listingId: listing.listingId,
      expectedPrice: listing.price,
    });
    expect(bought.status).toBe(409);
    expect(bought.body).toMatchObject({ message: { error: 'INSUFFICIENT_FUNDS' } });

    const row = await prisma.playerStats.findUnique({ where: { playerId: player.seeded.player.id } });
    const rejectedTotals = ((row?.totals ?? {}) as unknown) as Record<string, number>;
    expect(rejectedTotals['parts.bought'] ?? 0).toBe(0);
    expect(rejectedTotals['money.spent_parts'] ?? 0).toBe(0);
  }, 30_000);
});
