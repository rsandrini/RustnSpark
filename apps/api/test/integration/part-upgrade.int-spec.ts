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

  async function currentCredits(playerId: string): Promise<number> {
    const player = await prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { credits: true },
    });
    return player.credits;
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

  function upgradeMultiplier(rarity: string): number {
    return configService.snapshot().rules.economy.part_upgrade_price_multiplier[rarity] ?? 1;
  }

  it('quotes an eligible loose part: next tier, name and cost from the base-price gap', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const partId = await addLoosePart(player.seeded.player.id, 'hull');
    const [hull, hullUncommon] = await Promise.all([
      prisma.partCatalog.findUniqueOrThrow({ where: { partType: 'hull' } }),
      prisma.partCatalog.findUniqueOrThrow({ where: { partType: 'hull_uncommon' } }),
    ]);
    const expectedCost = Math.max(
      1,
      Math.round((hullUncommon.basePrice - hull.basePrice) * upgradeMultiplier('COMMON')),
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

  // Round-10 owner request: "Upgrade UI should show diff between current part and upgraded
  // part" — the diff popup needs the next tier's own stats (and rarity) to build a virtual
  // part to compare against, not just its name and the price.
  it('quotes the next tier\'s full catalog stats and rarity, for the upgrade diff popup', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const partId = await addLoosePart(player.seeded.player.id, 'hull');
    const hullUncommon = await prisma.partCatalog.findUniqueOrThrow({
      where: { partType: 'hull_uncommon' },
    });

    const response = await quoteUpgrade(player.token, partId);
    expect(response.status).toBe(200);
    const body = response.body as {
      nextRarity?: string;
      nextDescription?: { en: string; 'pt-BR': string };
      nextCatalog?: { partType: string; mass: number; structureCost: number; partHp: number };
    };
    expect(body.nextRarity).toBe(hullUncommon.rarity);
    expect(body.nextDescription?.en).toBeTruthy();
    expect(body.nextCatalog).toMatchObject({
      partType: 'hull_uncommon',
      mass: hullUncommon.mass,
      structureCost: hullUncommon.structureCost,
      partHp: hullUncommon.partHp,
    });
  });

  it('charges a higher markup for a rarer part (owner request, round 7: cost should grow with rarity)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const shieldPartId = await addLoosePart(player.seeded.player.id, 'shield_basic');
    const [shieldBasic, shieldRare] = await Promise.all([
      prisma.partCatalog.findUniqueOrThrow({ where: { partType: 'shield_basic' } }),
      prisma.partCatalog.findUniqueOrThrow({ where: { partType: 'shield_basic_rare' } }),
    ]);
    expect(shieldBasic.rarity).toBe('UNCOMMON');
    const commonMultiplier = upgradeMultiplier('COMMON');
    const uncommonMultiplier = upgradeMultiplier('UNCOMMON');
    // The config itself must actually escalate, or this test would pass for the wrong reason.
    expect(uncommonMultiplier).toBeGreaterThan(commonMultiplier);

    const response = await quoteUpgrade(player.token, shieldPartId);
    expect(response.status).toBe(200);
    const expectedCost = Math.max(
      1,
      Math.round((shieldRare.basePrice - shieldBasic.basePrice) * uncommonMultiplier),
    );
    expect((response.body as { cost: number }).cost).toBe(expectedCost);
  });

  it('reports MAX_TIER for a part already at the top rarity', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const partId = await addLoosePart(player.seeded.player.id, 'hull_legendary');

    const response = await quoteUpgrade(player.token, partId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ partInstanceId: partId, eligible: false, reason: 'MAX_TIER' });
  });

  it('reports NOT_FULL_CONDITION for a worn part, even with a real next tier (owner request, round 7)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const partId = await addLoosePart(player.seeded.player.id, 'hull', 99);

    const response = await quoteUpgrade(player.token, partId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      partInstanceId: partId,
      eligible: false,
      reason: 'NOT_FULL_CONDITION',
    });
  });

  it('reports NO_NEXT_TIER for a family the catalog has not chained', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    // Every seeded family is chained now, so take the laser's next tier out of the catalog: the
    // upgrade then has nowhere to go (an inactive tier counts as not existing).
    await prisma.partCatalog.update({ where: { partType: 'weapon_laser_rare' }, data: { active: false } });
    const partId = await addLoosePart(player.seeded.player.id, 'weapon_laser');

    const response = await quoteUpgrade(player.token, partId);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      partInstanceId: partId,
      eligible: false,
      reason: 'NO_NEXT_TIER',
    });
  });

  it('upgrades a loose part: charges the quoted cost, swaps the catalog reference, keeps condition at 100', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setCredits(player.seeded.player.id, 100000);
    // Owner request (round 7): only a fully-repaired part can be upgraded, so this now has to
    // start at 100 — 63 used to be a valid pre-upgrade condition here, proving the value carried
    // over unchanged; that specific case is now covered instead by the NOT_FULL_CONDITION tests.
    const partId = await addLoosePart(player.seeded.player.id, 'hull', 100);
    const quote = await quoteUpgrade(player.token, partId);
    const cost = (quote.body as { cost: number }).cost;

    const response = await doUpgrade(player.token, partId, randomUUID());
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      partInstanceId: partId,
      partType: 'hull_uncommon',
      rarity: 'UNCOMMON',
      condition: 100,
      cost,
      credits: 100000 - cost,
    });

    const stored = await prisma.partInstance.findUniqueOrThrow({ where: { id: partId } });
    expect(stored.partType).toBe('hull_uncommon');
    expect(stored.condition).toBe(100);

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

  it('rejects upgrading a worn part, without charging or changing it (owner request, round 7)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setCredits(player.seeded.player.id, 100000);
    const partId = await addLoosePart(player.seeded.player.id, 'hull', 99);

    const response = await doUpgrade(player.token, partId, randomUUID());
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'NOT_FULL_CONDITION' },
    });
    const stored = await prisma.partInstance.findUniqueOrThrow({ where: { id: partId } });
    expect(stored.partType).toBe('hull');
    expect(stored.condition).toBe(99);
    expect(await currentCredits(player.seeded.player.id)).toBe(100000);
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
