import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { MISSION_QUEUE_NAME, REPAIR_QUEUE_NAME } from '../../src/jobs/queues.js';
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

// Round-5 backlog item 4: upgrade a part in place to its next rarity tier. Mechanism only,
// per the owner's explicit scope — eligibility comes from the catalog's own tier-naming
// convention (part-upgrade.calculator.ts), never a curated field, so these tests exercise it
// against whatever real tier chains the seeded catalog happens to define (`hull` -> `hull_
// uncommon` is one) without asserting anything about catalog content beyond that.
describe('part upgrade API (round 5)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let configService: GameConfigService;
  let missionQueue: Queue;
  let repairQueue: Queue;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    configService = testApp.app.get(GameConfigService);
    missionQueue = testApp.app.get(getQueueToken(MISSION_QUEUE_NAME));
    repairQueue = testApp.app.get(getQueueToken(REPAIR_QUEUE_NAME));
  });

  afterEach(async () => {
    await resetDatabase(prisma);
    await missionQueue.obliterate({ force: true }).catch(() => undefined);
    await repairQueue.obliterate({ force: true }).catch(() => undefined);
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
      .set(auth(token))
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    await assembleStarterKit(httpServer(testApp.app), token, (onboarded.body as { id: string }).id);
    return { seeded, token, shipId: (onboarded.body as { id: string }).id };
  }

  const auth = (token: string): { Authorization: string } => ({
    Authorization: `Bearer ${token}`,
  });

  async function setCredits(playerId: string, credits: number): Promise<void> {
    await prisma.player.update({ where: { id: playerId }, data: { credits } });
  }

  async function addLoosePart(
    playerId: string,
    partType: string,
    condition = 100,
  ): Promise<string> {
    const created = await prisma.partInstance.create({
      data: { partType, ownerPlayerId: playerId, condition, location: 'INVENTORY' },
    });
    return created.id;
  }

  function quoteUpgrade(token: string, partInstanceId: string) {
    return request(httpServer(testApp.app))
      .post(`/v1/parts/${partInstanceId}/upgrade/quote`)
      .set(auth(token))
      .send();
  }

  function doUpgrade(token: string, partInstanceId: string, key: string | undefined) {
    const req = request(httpServer(testApp.app))
      .post(`/v1/parts/${partInstanceId}/upgrade`)
      .set(auth(token));
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req.send();
  }

  async function upgradeMultiplier(): Promise<number> {
    return configService.snapshot().rules.economy.part_upgrade_price_multiplier;
  }

  it('quotes an eligible loose part: next tier, name and cost from the base-price gap', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const partId = await addLoosePart(player.seeded.player.id, 'hull');
    const [hull, hullUncommon, multiplier] = await Promise.all([
      prisma.partCatalog.findUniqueOrThrow({ where: { partType: 'hull' } }),
      prisma.partCatalog.findUniqueOrThrow({ where: { partType: 'hull_uncommon' } }),
      upgradeMultiplier(),
    ]);
    const expectedCost = Math.max(
      1,
      Math.round((hullUncommon.basePrice - hull.basePrice) * multiplier),
    );

    const response = await quoteUpgrade(player.token, partId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      partInstanceId: partId,
      eligible: true,
      nextPartType: 'hull_uncommon',
      cost: expectedCost,
    });
  });

  it('reports MAX_TIER for a part already at the top rarity', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const partId = await addLoosePart(player.seeded.player.id, 'hull_legendary');

    const response = await quoteUpgrade(player.token, partId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ partInstanceId: partId, eligible: false, reason: 'MAX_TIER' });
  });

  it('reports NO_NEXT_TIER for a family the catalog has not chained', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    // weapon_laser exists only at COMMON in the seed catalog (no weapon_laser_uncommon row).
    const partId = await addLoosePart(player.seeded.player.id, 'weapon_laser');

    const response = await quoteUpgrade(player.token, partId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      partInstanceId: partId,
      eligible: false,
      reason: 'NO_NEXT_TIER',
    });
  });

  it('upgrades a loose part: charges the quoted cost, swaps the catalog reference, keeps condition', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setCredits(player.seeded.player.id, 100000);
    const partId = await addLoosePart(player.seeded.player.id, 'hull', 63);
    const quote = await quoteUpgrade(player.token, partId);
    const cost = (quote.body as { cost: number }).cost;

    const response = await doUpgrade(player.token, partId, randomUUID());
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      partInstanceId: partId,
      partType: 'hull_uncommon',
      rarity: 'UNCOMMON',
      condition: 63,
      cost,
      credits: 100000 - cost,
    });

    const stored = await prisma.partInstance.findUniqueOrThrow({ where: { id: partId } });
    expect(stored.partType).toBe('hull_uncommon');
    expect(stored.condition).toBe(63);

    const events = await prisma.playerEvent.findMany({
      where: { playerId: player.seeded.player.id, type: 'part.upgraded' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      partInstanceId: partId,
      fromPartType: 'hull',
      toPartType: 'hull_uncommon',
      cost,
    });
  });

  it('rejects upgrading past the top tier', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const partId = await addLoosePart(player.seeded.player.id, 'hull_legendary');

    const response = await doUpgrade(player.token, partId, randomUUID());
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ statusCode: 409, message: { error: 'MAX_TIER' } });
  });

  it('rejects INSUFFICIENT_FUNDS without changing the part', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setCredits(player.seeded.player.id, 1);
    const partId = await addLoosePart(player.seeded.player.id, 'hull');

    const response = await doUpgrade(player.token, partId, randomUUID());
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'INSUFFICIENT_FUNDS' },
    });
    const stored = await prisma.partInstance.findUniqueOrThrow({ where: { id: partId } });
    expect(stored.partType).toBe('hull');
  });

  it('rejects upgrading an installed part while the ship is on a mission', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setCredits(player.seeded.player.id, 100000);
    const installed = await prisma.partInstance.findFirstOrThrow({
      where: { shipId: player.shipId, location: 'INSTALLED', partType: 'hull' },
    });
    await prisma.ship.update({ where: { id: player.shipId }, data: { status: 'ON_MISSION' } });

    const response = await doUpgrade(player.token, installed.id, randomUUID());
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_ON_MISSION' },
    });
  });

  it("rejects upgrading a part owned by another player", async () => {
    await freshSeededApp();
    const owner = await onboardPlayer();
    const stranger = await onboardPlayer();
    const partId = await addLoosePart(owner.seeded.player.id, 'hull');

    const response = await doUpgrade(stranger.token, partId, randomUUID());
    expect(response.status).toBe(404);
  });

  it('upgrade is idempotent: missing key 400, same key replays once', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setCredits(player.seeded.player.id, 100000);
    const partId = await addLoosePart(player.seeded.player.id, 'hull');

    const noKey = await doUpgrade(player.token, partId, undefined);
    expect(noKey.status).toBe(400);

    const key = randomUUID();
    const first = await doUpgrade(player.token, partId, key);
    const replay = await doUpgrade(player.token, partId, key);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);

    const events = await prisma.playerEvent.findMany({
      where: { playerId: player.seeded.player.id, type: 'part.upgraded' },
    });
    expect(events).toHaveLength(1);
  });
});
