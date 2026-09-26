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

interface RefuelBody {
  shipId: string;
  units: number;
  cost: number;
  fuel: number;
  fuelCap: number;
  credits: number;
}

// S8.3 acceptance (plan line 473): refuel is instant (no job), capped by the tank's
// derived fuelCap, priced with fuel_price × isolation × faction (plan S5.8 location
// factor — mood applies to part prices only), debited atomically with the fuel update,
// and idempotent like every other spending endpoint.
describe('refuel API (S8.3)', () => {
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
    // Same shared-Redis hygiene as the repair/market specs: nothing queued by this
    // app may outlive the file.
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

  function refuel(
    token: string,
    shipId: string,
    key: string | undefined,
    body: Record<string, unknown>,
  ) {
    const req = request(httpServer(testApp.app))
      .post(`/v1/ships/${shipId}/refuel`)
      .set(auth(token));
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req.send(body);
  }

  async function fuelCapOf(shipId: string): Promise<number> {
    const rows = await prisma.partInstance.findMany({
      where: { shipId, location: 'INSTALLED' },
      include: { partCatalog: true },
    });
    return rows.reduce((total, row) => total + (row.partCatalog.fuelCap ?? 0), 0);
  }

  // Mirrors PricingService's relation lookup so the expected price is computed from
  // the same seed data (location.isolation × faction relation × fuel_price).
  async function unitPriceForShip(shipId: string, playerId: string): Promise<number> {
    const [ship, player] = await Promise.all([
      prisma.ship.findUniqueOrThrow({ where: { id: shipId }, select: { currentLocationId: true } }),
      prisma.player.findUniqueOrThrow({ where: { id: playerId }, select: { factionId: true } }),
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
    return rules.economy.fuel_price * location.isolation * factionMult;
  }

  function expectedCost(units: number, unitPrice: number): number {
    return Math.max(1, Math.round(units * unitPrice));
  }

  async function setShipFuel(shipId: string, fuel: number): Promise<void> {
    await prisma.ship.update({ where: { id: shipId }, data: { fuel } });
  }

  async function setCredits(playerId: string, credits: number): Promise<void> {
    await prisma.player.update({ where: { id: playerId }, data: { credits } });
  }

  async function currentFuel(shipId: string): Promise<number> {
    const ship = await prisma.ship.findUniqueOrThrow({
      where: { id: shipId },
      select: { fuel: true },
    });
    return ship.fuel;
  }

  async function currentCredits(playerId: string): Promise<number> {
    const player = await prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { credits: true },
    });
    return player.credits;
  }

  it('full refuel fills the tank atomically and records the event', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const fuelCap = await fuelCapOf(player.shipId);
    const unitPrice = await unitPriceForShip(player.shipId, player.seeded.player.id);
    await setCredits(player.seeded.player.id, 100000);
    await setShipFuel(player.shipId, 0);

    const response = await refuel(player.token, player.shipId, randomUUID(), { mode: 'full' });
    expect(response.status).toBe(200);

    const cost = expectedCost(fuelCap, unitPrice);
    expect(response.body as RefuelBody).toMatchObject({
      shipId: player.shipId,
      units: fuelCap,
      cost,
      fuel: fuelCap,
      fuelCap,
      credits: 100000 - cost,
    });
    expect(await currentFuel(player.shipId)).toBe(fuelCap);
    expect(await currentCredits(player.seeded.player.id)).toBe(100000 - cost);

    const events = await prisma.playerEvent.findMany({
      where: { playerId: player.seeded.player.id, type: 'refuel' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ shipId: player.shipId, units: fuelCap, cost });
  });

  it('partial refuel is capped by the tank', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const fuelCap = await fuelCapOf(player.shipId);
    const unitPrice = await unitPriceForShip(player.shipId, player.seeded.player.id);
    await setCredits(player.seeded.player.id, 100000);
    await setShipFuel(player.shipId, fuelCap - 40);

    const response = await refuel(player.token, player.shipId, randomUUID(), {
      mode: 'partial',
      amount: 500,
    });
    expect(response.status).toBe(200);
    expect(response.body as RefuelBody).toMatchObject({
      units: 40,
      cost: expectedCost(40, unitPrice),
      fuel: fuelCap,
      fuelCap,
    });
    expect(await currentFuel(player.shipId)).toBe(fuelCap);
  });

  it('partial refuel buys exactly the requested amount', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const fuelCap = await fuelCapOf(player.shipId);
    const unitPrice = await unitPriceForShip(player.shipId, player.seeded.player.id);
    await setCredits(player.seeded.player.id, 100000);
    await setShipFuel(player.shipId, 0);

    const response = await refuel(player.token, player.shipId, randomUUID(), {
      mode: 'partial',
      amount: 100,
    });
    expect(response.status).toBe(200);
    const cost = expectedCost(100, unitPrice);
    expect(response.body as RefuelBody).toMatchObject({
      units: 100,
      cost,
      fuel: 100,
      fuelCap,
      credits: 100000 - cost,
    });
    expect(await currentCredits(player.seeded.player.id)).toBe(100000 - cost);
  });

  it('refueling a full tank is a free no-op', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const fuelCap = await fuelCapOf(player.shipId);

    // Onboarding ships start with a full tank and 200 credits.
    const response = await refuel(player.token, player.shipId, randomUUID(), { mode: 'full' });
    expect(response.status).toBe(200);
    expect(response.body as RefuelBody).toMatchObject({
      units: 0,
      cost: 0,
      fuel: fuelCap,
      fuelCap,
      credits: 200,
    });
    expect(await currentCredits(player.seeded.player.id)).toBe(200);
    const events = await prisma.playerEvent.findMany({
      where: { playerId: player.seeded.player.id, type: 'refuel' },
    });
    expect(events).toHaveLength(0);
  });

  it('rejects INSUFFICIENT_FUNDS without touching the tank', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setCredits(player.seeded.player.id, 5);
    await setShipFuel(player.shipId, 0);

    const response = await refuel(player.token, player.shipId, randomUUID(), { mode: 'full' });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'INSUFFICIENT_FUNDS' },
    });
    expect(await currentFuel(player.shipId)).toBe(0);
    expect(await currentCredits(player.seeded.player.id)).toBe(5);
  });

  it('rejects refuel while the ship is on a mission', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await prisma.ship.update({
      where: { id: player.shipId },
      data: { status: 'ON_MISSION' },
    });
    await setShipFuel(player.shipId, 0);

    const response = await refuel(player.token, player.shipId, randomUUID(), { mode: 'full' });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_ON_MISSION' },
    });
    expect(await currentFuel(player.shipId)).toBe(0);
    expect(await currentCredits(player.seeded.player.id)).toBe(200);
  });

  it('rejects a negative balance (GDD §14) before buying fuel', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setCredits(player.seeded.player.id, -50);

    const response = await refuel(player.token, player.shipId, randomUUID(), { mode: 'full' });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'BALANCE_NEGATIVE' },
    });
    expect(await currentCredits(player.seeded.player.id)).toBe(-50);
  });

  it('refuel is idempotent: missing key 400, same key+body replays once', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setCredits(player.seeded.player.id, 100000);
    await setShipFuel(player.shipId, 0);

    const noKey = await refuel(player.token, player.shipId, undefined, { mode: 'full' });
    expect(noKey.status).toBe(400);
    expect(noKey.body).toMatchObject({
      statusCode: 400,
      message: 'IDEMPOTENCY_KEY_REQUIRED',
    });

    const key = randomUUID();
    const body = { mode: 'partial', amount: 100 };
    const first = await refuel(player.token, player.shipId, key, body);
    const replay = await refuel(player.token, player.shipId, key, body);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);

    const cost = (first.body as RefuelBody).cost;
    expect(await currentFuel(player.shipId)).toBe(100);
    expect(await currentCredits(player.seeded.player.id)).toBe(100000 - cost);
  });

  it('a partial refuel without a key is rejected before any fuel is bought (review item 10)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setShipFuel(player.shipId, 0);

    const noKey = await refuel(player.token, player.shipId, undefined, {
      mode: 'partial',
      amount: 10,
    });
    expect(noKey.status).toBe(400);
    expect(noKey.body).toMatchObject({
      statusCode: 400,
      message: 'IDEMPOTENCY_KEY_REQUIRED',
    });
    expect(await currentFuel(player.shipId)).toBe(0);
    expect(await currentCredits(player.seeded.player.id)).toBe(200);

    const keyed = await refuel(player.token, player.shipId, randomUUID(), {
      mode: 'partial',
      amount: 10,
    });
    expect(keyed.status).toBe(200);
    expect(await currentFuel(player.shipId)).toBe(10);
  });

  it('validates refuel input: unknown mode 400, partial without amount 400', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();

    const badMode = await refuel(player.token, player.shipId, randomUUID(), {
      mode: 'sideways',
    });
    expect(badMode.status).toBe(400);

    const noAmount = await refuel(player.token, player.shipId, randomUUID(), {
      mode: 'partial',
    });
    expect(noAmount.status).toBe(400);
    expect(noAmount.body).toMatchObject({
      statusCode: 400,
      message: { error: 'INVALID_AMOUNT' },
    });
  });
});
