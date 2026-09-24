import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
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

interface MaterialHolding {
  materialId: string;
  rarity: string;
  quantity: number;
  unitPrice: number;
}

interface MaterialsBody {
  locationId: string;
  materials: MaterialHolding[];
}

interface SellMaterialBody {
  materialId: string;
  quantity: number;
  price: number;
  credits: number;
}

// S8.7 acceptance (plan line 485): materials are priced
// `basePrice × isolation × faction × mood × sell_ratio`, selling more than you hold is a
// 400 with no credit, the sale is idempotent, and the negative-balance spending guard
// blocks buying only — selling is always allowed (GDD §14 "cava e sai cavando").
describe('materials API (S8.7)', () => {
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
    return { seeded, token, shipId: (onboarded.body as { id: string }).id };
  }

  const auth = (token: string): { Authorization: string } => ({
    Authorization: `Bearer ${token}`,
  });

  function listMaterials(token: string) {
    return request(httpServer(testApp.app)).get('/v1/materials').set(auth(token));
  }

  function sellMaterial(token: string, key: string | undefined, body: Record<string, unknown>) {
    const req = request(httpServer(testApp.app)).post('/v1/market/sell-material').set(auth(token));
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req.send(body);
  }

  // Mirrors PricingService's relation lookup so the expected price is computed from the
  // same seed data and rules (basePrice × isolation × faction × mood × sell_ratio).
  async function unitPriceFor(playerId: string, materialId: string): Promise<number> {
    const [ship, player, material] = await Promise.all([
      prisma.ship.findFirstOrThrow({
        where: { ownerPlayerId: playerId },
        orderBy: { id: 'asc' },
        select: { currentLocationId: true },
      }),
      prisma.player.findUniqueOrThrow({ where: { id: playerId }, select: { factionId: true } }),
      prisma.material.findUniqueOrThrow({ where: { id: materialId } }),
    ]);
    const location = await prisma.location.findUniqueOrThrow({
      where: { id: ship.currentLocationId },
      include: { faction: { select: { relations: true } } },
    });
    const rules = configService.snapshot().rules;
    const relations = location.faction.relations as Record<string, unknown>;
    const raw = player.factionId === null ? null : relations[player.factionId];
    const relation = raw === 'ally' || raw === 'hostile' ? raw : 'neutral';
    const factionMult = rules.economy.faction_mult[relation] ?? 1;
    return Math.max(
      0,
      Math.round(
        material.basePrice *
          location.isolation *
          factionMult *
          location.mood *
          rules.economy.sell_ratio,
      ),
    );
  }

  async function hold(playerId: string, materialId: string, quantity: number): Promise<void> {
    await prisma.playerMaterial.upsert({
      where: { playerId_materialId: { playerId, materialId } },
      create: { playerId, materialId, quantity },
      update: { quantity },
    });
  }

  async function heldQuantity(playerId: string, materialId: string): Promise<number | null> {
    const row = await prisma.playerMaterial.findUnique({
      where: { playerId_materialId: { playerId, materialId } },
      select: { quantity: true },
    });
    return row?.quantity ?? null;
  }

  async function currentCredits(playerId: string): Promise<number> {
    const player = await prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { credits: true },
    });
    return player.credits;
  }

  it('lists holdings with the local sell price, empty when holding nothing', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();

    const empty = await listMaterials(player.token);
    expect(empty.status).toBe(200);
    expect(empty.body as MaterialsBody).toMatchObject({ materials: [] });

    await hold(player.seeded.player.id, 'common_ore', 7);
    await hold(player.seeded.player.id, 'rare_crystals', 2);

    const listed = await listMaterials(player.token);
    expect(listed.status).toBe(200);
    const body = listed.body as MaterialsBody;
    const ship = await prisma.ship.findFirstOrThrow({
      where: { id: player.shipId },
      select: { currentLocationId: true },
    });
    expect(body.locationId).toBe(ship.currentLocationId);
    expect(body.materials.map((m) => m.materialId)).toEqual(['common_ore', 'rare_crystals']);
    expect(body.materials[0]).toMatchObject({
      materialId: 'common_ore',
      rarity: 'COMMON',
      quantity: 7,
      unitPrice: await unitPriceFor(player.seeded.player.id, 'common_ore'),
    });
    expect(body.materials[1]).toMatchObject({
      materialId: 'rare_crystals',
      rarity: 'RARE',
      quantity: 2,
      unitPrice: await unitPriceFor(player.seeded.player.id, 'rare_crystals'),
    });
  });

  it('sells a stack atomically: credits, holding and event move together', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await hold(player.seeded.player.id, 'common_ore', 10);
    const unitPrice = await unitPriceFor(player.seeded.player.id, 'common_ore');

    const response = await sellMaterial(player.token, randomUUID(), {
      materialId: 'common_ore',
      quantity: 3,
      expectedPrice: unitPrice * 3,
    });
    expect(response.status).toBe(200);
    expect(response.body as SellMaterialBody).toMatchObject({
      materialId: 'common_ore',
      quantity: 3,
      price: unitPrice * 3,
      credits: 200 + unitPrice * 3,
    });
    expect(await heldQuantity(player.seeded.player.id, 'common_ore')).toBe(7);
    expect(await currentCredits(player.seeded.player.id)).toBe(200 + unitPrice * 3);

    const events = await prisma.playerEvent.findMany({
      where: { playerId: player.seeded.player.id, type: 'market.sell_material' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      materialId: 'common_ore',
      quantity: 3,
      price: unitPrice * 3,
    });
  });

  it('clears the holding row once the whole stack is sold', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await hold(player.seeded.player.id, 'uncommon_minerals', 2);
    const unitPrice = await unitPriceFor(player.seeded.player.id, 'uncommon_minerals');

    const response = await sellMaterial(player.token, randomUUID(), {
      materialId: 'uncommon_minerals',
      quantity: 2,
      expectedPrice: unitPrice * 2,
    });
    expect(response.status).toBe(200);
    expect(await heldQuantity(player.seeded.player.id, 'uncommon_minerals')).toBeNull();

    const listed = await listMaterials(player.token);
    expect((listed.body as MaterialsBody).materials).toEqual([]);
  });

  it('rejects a stale price with PRICE_CHANGED and moves nothing', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await hold(player.seeded.player.id, 'common_ore', 10);
    const unitPrice = await unitPriceFor(player.seeded.player.id, 'common_ore');

    const response = await sellMaterial(player.token, randomUUID(), {
      materialId: 'common_ore',
      quantity: 3,
      expectedPrice: 1,
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'PRICE_CHANGED', actual: unitPrice * 3 },
    });
    expect(await heldQuantity(player.seeded.player.id, 'common_ore')).toBe(10);
    expect(await currentCredits(player.seeded.player.id)).toBe(200);
  });

  it('rejects selling more than held with 400 and no credit', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await hold(player.seeded.player.id, 'common_ore', 2);
    const unitPrice = await unitPriceFor(player.seeded.player.id, 'common_ore');

    const tooMany = await sellMaterial(player.token, randomUUID(), {
      materialId: 'common_ore',
      quantity: 3,
      expectedPrice: unitPrice * 3,
    });
    expect(tooMany.status).toBe(400);
    expect(tooMany.body).toMatchObject({
      statusCode: 400,
      message: { error: 'INSUFFICIENT_MATERIALS' },
    });
    expect(await heldQuantity(player.seeded.player.id, 'common_ore')).toBe(2);
    expect(await currentCredits(player.seeded.player.id)).toBe(200);

    const zero = await sellMaterial(player.token, randomUUID(), {
      materialId: 'common_ore',
      quantity: 0,
      expectedPrice: 0,
    });
    expect(zero.status).toBe(400);
    expect(zero.body).toMatchObject({
      statusCode: 400,
      message: { error: 'INVALID_QUANTITY' },
    });

    const unknown = await sellMaterial(player.token, randomUUID(), {
      materialId: 'not_a_material',
      quantity: 1,
      expectedPrice: 0,
    });
    expect(unknown.status).toBe(404);
  });

  it('selling is allowed while the balance is negative (GDD §14)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await hold(player.seeded.player.id, 'common_ore', 5);
    await prisma.player.update({
      where: { id: player.seeded.player.id },
      data: { credits: -500 },
    });
    const unitPrice = await unitPriceFor(player.seeded.player.id, 'common_ore');

    const response = await sellMaterial(player.token, randomUUID(), {
      materialId: 'common_ore',
      quantity: 5,
      expectedPrice: unitPrice * 5,
    });
    expect(response.status).toBe(200);
    expect(response.body as SellMaterialBody).toMatchObject({
      price: unitPrice * 5,
      credits: -500 + unitPrice * 5,
    });
    expect(await heldQuantity(player.seeded.player.id, 'common_ore')).toBeNull();
  });

  it('is idempotent: missing key 400, same key+body sells once', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await hold(player.seeded.player.id, 'common_ore', 10);
    const unitPrice = await unitPriceFor(player.seeded.player.id, 'common_ore');
    const body = { materialId: 'common_ore', quantity: 3, expectedPrice: unitPrice * 3 };

    const noKey = await sellMaterial(player.token, undefined, body);
    expect(noKey.status).toBe(400);
    expect(noKey.body).toMatchObject({
      statusCode: 400,
      message: 'IDEMPOTENCY_KEY_REQUIRED',
    });
    expect(await heldQuantity(player.seeded.player.id, 'common_ore')).toBe(10);

    const key = randomUUID();
    const first = await sellMaterial(player.token, key, body);
    const replay = await sellMaterial(player.token, key, body);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await heldQuantity(player.seeded.player.id, 'common_ore')).toBe(7);
    expect(await currentCredits(player.seeded.player.id)).toBe(200 + unitPrice * 3);
    await expect(
      prisma.playerEvent.count({
        where: { playerId: player.seeded.player.id, type: 'market.sell_material' },
      }),
    ).resolves.toBe(1);
  });
});
