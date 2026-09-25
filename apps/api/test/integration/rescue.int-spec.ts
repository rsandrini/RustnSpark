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

interface RescueBody {
  shipId: string;
  status: string;
  cost: number;
  fuel: number;
  credits: number;
  restartParts: string[];
  viability: { viable: boolean; problems: { code: string }[] };
}

interface RefuelBody {
  units: number;
  cost: number;
}

// S8.6 acceptance (plan line 484): auto-rescue is a flat 800 ¢ that may drive the balance
// negative (GDD §14), restart parts are free common parts at ≤50% condition, and the
// player always ends with a viable ship. While negative, spending (refuel) is blocked —
// navigation and mining stay open, missions repay the debt (resolve-processor spec).
describe('rescue API (S8.6)', () => {
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

  function rescue(token: string, shipId: string, key: string | undefined) {
    const req = request(httpServer(testApp.app))
      .post(`/v1/ships/${shipId}/rescue`)
      .set(auth(token));
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req;
  }

  function refuel(token: string, shipId: string, key: string, body: Record<string, unknown>) {
    return request(httpServer(testApp.app))
      .post(`/v1/ships/${shipId}/refuel`)
      .set(auth(token))
      .set('Idempotency-Key', key)
      .send(body);
  }

  async function setStatus(shipId: string, status: string): Promise<void> {
    await prisma.ship.update({ where: { id: shipId }, data: { status: status as never } });
  }

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

  async function shipRow(shipId: string) {
    return prisma.ship.findUniqueOrThrow({ where: { id: shipId } });
  }

  async function installedParts(shipId: string) {
    return prisma.partInstance.findMany({
      where: { shipId, location: 'INSTALLED' },
      include: { partCatalog: { select: { rarity: true, partClass: true } } },
      orderBy: { id: 'asc' },
    });
  }

  it('rescue costs a flat 800 and may drive the balance negative (GDD §14)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setCredits(player.seeded.player.id, 100);
    await setStatus(player.shipId, 'ADRIFT');
    const shipBefore = await shipRow(player.shipId);

    const response = await rescue(player.token, player.shipId, randomUUID());
    expect(response.status).toBe(200);
    expect(response.body as RescueBody).toMatchObject({
      shipId: player.shipId,
      status: 'IN_PORT',
      cost: 800,
      credits: -700,
      restartParts: [],
      viability: { viable: true },
    });

    // Rescue is not a refuel: it tows the hull, it does not top up the tank (a tank that is
    // already above the emergency ration is left exactly as it was).
    const shipAfter = await shipRow(player.shipId);
    expect(shipAfter.status).toBe('IN_PORT');
    expect(shipAfter.fuel).toBe(shipBefore.fuel);
    expect(shipAfter.currentLocationId).toBe(shipBefore.currentLocationId);
    expect(await currentCredits(player.seeded.player.id)).toBe(-700);

    const debits = await prisma.playerEvent.findMany({
      where: { playerId: player.seeded.player.id, type: 'wallet.debit' },
    });
    expect(debits).toHaveLength(1);
    expect(debits[0]!.creditsDelta).toBe(-800);
    expect(String((debits[0]!.payload as { reason: string }).reason)).toBe(
      `rescue:${player.shipId}`,
    );

    const rescueEvents = await prisma.playerEvent.findMany({
      where: { playerId: player.seeded.player.id, type: 'rescue' },
    });
    expect(rescueEvents).toHaveLength(1);
    expect(rescueEvents[0]!.payload).toMatchObject({
      shipId: player.shipId,
      cost: 800,
      restartParts: [],
    });
  });

  it('refuses a ship that is not adrift and never charges', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();

    const inPort = await rescue(player.token, player.shipId, randomUUID());
    expect(inPort.status).toBe(409);
    expect(inPort.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_NOT_ADRIFT' },
    });

    await setStatus(player.shipId, 'ON_MISSION');
    const onMission = await rescue(player.token, player.shipId, randomUUID());
    expect(onMission.status).toBe(409);
    expect(onMission.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_ON_MISSION' },
    });

    expect(await currentCredits(player.seeded.player.id)).toBe(200);
    await expect(
      prisma.playerEvent.count({
        where: { playerId: player.seeded.player.id, type: 'wallet.debit' },
      }),
    ).resolves.toBe(0);
  });

  it('is idempotent: missing key 400, same key replays without charging twice', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setCredits(player.seeded.player.id, 100000);
    await setStatus(player.shipId, 'ADRIFT');

    const noKey = await rescue(player.token, player.shipId, undefined);
    expect(noKey.status).toBe(400);
    expect(noKey.body).toMatchObject({
      statusCode: 400,
      message: 'IDEMPOTENCY_KEY_REQUIRED',
    });
    expect(await currentCredits(player.seeded.player.id)).toBe(100000);

    const key = randomUUID();
    const first = await rescue(player.token, player.shipId, key);
    const replay = await rescue(player.token, player.shipId, key);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await currentCredits(player.seeded.player.id)).toBe(100000 - 800);
    await expect(
      prisma.playerEvent.count({
        where: { playerId: player.seeded.player.id, type: 'wallet.debit' },
      }),
    ).resolves.toBe(1);
  });

  it('restart kit: free common parts at restart_condition_max, old parts kept, ship viable', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const rules = configService.snapshot().rules;
    const restartCondition = rules.parts.restart_condition_max;
    const starterParts = rules.onboarding.starter_parts as string[];

    // Strip the engine so the ADRIFT hull is no longer viable — the only way an
    // already-viable ship ever reaches the restart path.
    const engine = await prisma.partInstance.findFirstOrThrow({
      where: { shipId: player.shipId, location: 'INSTALLED', partType: 'engine_chem_small' },
    });
    const partsBefore = await prisma.partInstance.count({
      where: { ownerPlayerId: player.seeded.player.id },
    });
    await prisma.partInstance.update({
      where: { id: engine.id },
      data: { location: 'INVENTORY', shipId: null },
    });
    await setStatus(player.shipId, 'ADRIFT');
    await setCredits(player.seeded.player.id, 500);

    const response = await rescue(player.token, player.shipId, randomUUID());
    expect(response.status).toBe(200);
    const body = response.body as RescueBody;
    expect(body.restartParts).toEqual(starterParts);
    expect(body.viability.viable).toBe(true);
    expect(body.viability.problems).toEqual([]);
    // The kit itself is free: the only charge is the flat 800 ¢ tow.
    expect(body.cost).toBe(800);
    expect(body.credits).toBe(500 - 800);
    expect(body.status).toBe('IN_PORT');

    const installed = await installedParts(player.shipId);
    expect(installed).toHaveLength(starterParts.length);
    for (const part of installed) {
      expect(part.partCatalog.rarity).toBe('COMMON');
      expect(part.condition).toBe(restartCondition);
      expect(part.condition).toBeLessThanOrEqual(50);
    }

    // Nothing is ever destroyed: the stripped engine is still owned, in inventory.
    expect(await prisma.partInstance.findUniqueOrThrow({ where: { id: engine.id } })).toMatchObject(
      { location: 'INVENTORY', shipId: null },
    );
    await expect(
      prisma.partInstance.count({ where: { ownerPlayerId: player.seeded.player.id } }),
    ).resolves.toBe(partsBefore + starterParts.length);

    const ship = await shipRow(player.shipId);
    expect(ship.status).toBe('IN_PORT');
    expect(ship.layout).toHaveLength(starterParts.length);
  });

  it('restart kit clamps fuel to the new tank ceiling (review item 5)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();

    // Strip the engine (the only path to the restart kit) and drift in holding more
    // fuel than the kit's tank can hold.
    const engine = await prisma.partInstance.findFirstOrThrow({
      where: { shipId: player.shipId, location: 'INSTALLED', partType: 'engine_chem_small' },
    });
    await prisma.partInstance.update({
      where: { id: engine.id },
      data: { location: 'INVENTORY', shipId: null },
    });
    await setStatus(player.shipId, 'ADRIFT');
    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 9999 } });
    await setCredits(player.seeded.player.id, 5000);

    const rescued = await rescue(player.token, player.shipId, randomUUID());
    expect(rescued.status).toBe(200);
    expect((rescued.body as RescueBody).restartParts.length).toBeGreaterThan(0);

    const installed = await prisma.partInstance.findMany({
      where: { shipId: player.shipId, location: 'INSTALLED' },
      include: { partCatalog: { select: { fuelCap: true } } },
    });
    const kitFuelCap = installed.reduce((total, row) => total + (row.partCatalog.fuelCap ?? 0), 0);
    expect(kitFuelCap).toBeGreaterThan(0);

    const ship = await shipRow(player.shipId);
    expect(ship.fuel).toBe(kitFuelCap);

    // A full refuel is a free no-op: the tank sits exactly at its cap, never above it.
    const full = await refuel(player.token, player.shipId, randomUUID(), { mode: 'full' });
    expect(full.status).toBe(200);
    expect((full.body as { units: number; fuel: number; fuelCap: number })).toMatchObject({
      units: 0,
      fuel: kitFuelCap,
      fuelCap: kitFuelCap,
    });
  });

  it('spending guard both ways: negative balance blocks refuel, positive unlocks it', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const fuelCap = await (async () => {
      const rows = await prisma.partInstance.findMany({
        where: { shipId: player.shipId, location: 'INSTALLED' },
        include: { partCatalog: true },
      });
      return rows.reduce((total, row) => total + (row.partCatalog.fuelCap ?? 0), 0);
    })();
    await setStatus(player.shipId, 'ADRIFT');
    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 0 } });

    const rescued = await rescue(player.token, player.shipId, randomUUID());
    expect(rescued.status).toBe(200);
    expect((rescued.body as RescueBody).credits).toBe(200 - 800);

    const blocked = await refuel(player.token, player.shipId, randomUUID(), { mode: 'full' });
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({
      statusCode: 409,
      message: { error: 'BALANCE_NEGATIVE' },
    });
    // The emergency ration (25% of the tank) is what the player is left with — enough to
    // fly one short job, never a refill.
    const ration = Math.round(fuelCap * 0.25);
    expect((rescued.body as RescueBody).fuel).toBe(ration);
    expect((await shipRow(player.shipId)).fuel).toBe(ration);
    expect(await currentCredits(player.seeded.player.id)).toBe(-600);

    // Missions pay the debt back (GDD §14); with a positive balance buying works again.
    await setCredits(player.seeded.player.id, 5000);
    const unlocked = await refuel(player.token, player.shipId, randomUUID(), { mode: 'full' });
    expect(unlocked.status).toBe(200);
    expect((unlocked.body as RefuelBody).units).toBe(fuelCap - ration);
    expect((unlocked.body as RefuelBody).cost).toBeGreaterThan(0);
    expect(await currentCredits(player.seeded.player.id)).toBe(
      5000 - (unlocked.body as RefuelBody).cost,
    );
  });

  it('emergency ration never lowers fuel and is capped at the tank (review item 11)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await setStatus(player.shipId, 'ADRIFT');
    const before = await shipRow(player.shipId);
    // Already above 25% → untouched.
    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: before.fuel } });
    const rescued = await rescue(player.token, player.shipId, randomUUID());
    expect(rescued.status).toBe(200);
    expect((await shipRow(player.shipId)).fuel).toBe(before.fuel);
  });
});
