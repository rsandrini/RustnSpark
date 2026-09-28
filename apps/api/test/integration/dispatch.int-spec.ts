import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import type { MissionInstance } from '@prisma/client';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
import { seed } from '../../prisma/seed.js';
import { AppModule } from '../../src/app.module.js';
import { EnvService } from '../../src/common/env/env.module.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { MISSION_QUEUE_NAME } from '../../src/jobs/queues.js';
import { configureApp } from '../../src/main.js';
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

// S7.2 acceptance (plan line 435): duration formula + class, one transaction covering
// ownership → viability → fuel → snapshot → ship ON_MISSION → mission IN_TRANSIT with
// arrivalAt → presence rows, enqueue after commit with jobId = missionId, enqueue
// failure leaves a reconcilable mission, response carries arrivalAt + serverTime,
// dispatch idempotent.
describe('ship dispatch API (S7.2)', () => {
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

  async function authFor(app: INestApplication): Promise<AuthPair> {
    const passwords = app.get(PasswordService);
    const tokens = app.get(TokenService);
    const seeded = await seedAccountWithPlayer(prisma, passwords);
    const token = await tokens.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const onboarded = await request(httpServer(app))
      .post('/v1/players/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    await assembleStarterKit(httpServer(app), token, (onboarded.body as { id: string }).id);
    return { seeded, token, shipId: (onboarded.body as { id: string }).id };
  }

  async function onboardPlayer(): Promise<AuthPair> {
    return authFor(testApp.app);
  }

  const auth = (token: string): { Authorization: string } => ({
    Authorization: `Bearer ${token}`,
  });

  async function createMission(
    player: AuthPair,
    legDistances: readonly number[],
    overrides: { originId?: string } = {},
  ): Promise<MissionInstance> {
    const template = await prisma.missionTemplate.findFirstOrThrow({
      where: { type: 'DELIVERY' },
      orderBy: { id: 'asc' },
    });
    const route = await prisma.route.findFirstOrThrow({ orderBy: { id: 'asc' } });
    return prisma.missionInstance.create({
      data: {
        templateId: template.id,
        type: 'DELIVERY',
        factionId: template.factionId,
        originId: overrides.originId ?? 'ceres',
        destinationId: 'hedus',
        legs: legDistances.map((distance) => ({
          routeId: route.id,
          distance,
          danger: 1,
          zone: 0,
          env: { id: 'belt', level: 1, fuelMult: 1 },
        })),
        cargo: {},
        reward: 100,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        seed: `s7.2-${randomUUID()}`,
        status: 'ACCEPTED',
        playerId: player.seeded.player.id,
        shipId: player.shipId,
        acceptedAt: new Date(),
      },
    });
  }

  async function createAvailableMission(): Promise<MissionInstance> {
    const template = await prisma.missionTemplate.findFirstOrThrow({
      where: { type: 'DELIVERY' },
      orderBy: { id: 'asc' },
    });
    return prisma.missionInstance.create({
      data: {
        templateId: template.id,
        type: 'DELIVERY',
        factionId: template.factionId,
        originId: 'ceres',
        destinationId: 'hedus',
        legs: [{ distance: 40, danger: 1, zone: 0, env: { id: 'belt', level: 1, fuelMult: 1 } }],
        cargo: {},
        reward: 100,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        seed: `s7.2-avail-${randomUUID()}`,
        status: 'AVAILABLE',
      },
    });
  }

  function dispatch(token: string, shipId: string, missionId: string) {
    return request(httpServer(testApp.app))
      .post(`/v1/ships/${shipId}/dispatch`)
      .set(auth(token))
      .send({ missionId });
  }

  it('dispatches an accepted mission: duration, IN_TRANSIT, ON_MISSION, presence windows, delayed job', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [30, 10]);

    const shipResponse = await request(httpServer(testApp.app))
      .get(`/v1/ships/${player.shipId}`)
      .set(auth(player.token));
    expect(shipResponse.status).toBe(200);
    const mob = (shipResponse.body as { sheet: { mob: number } }).sheet.mob;
    const { rules } = configService.snapshot();
    const expectedSeconds =
      Math.round((40 / mob) * rules.missions.duration_k) * rules.missions.time_scale;

    const response = await dispatch(player.token, player.shipId, mission.id);
    expect(response.status).toBe(200);
    const body = response.body as {
      missionId: string;
      arrivalAt: string;
      serverTime: string;
      durationSeconds: number;
      durationClass: string;
    };
    expect(body.missionId).toBe(mission.id);
    expect(body.durationSeconds).toBe(expectedSeconds);
    const cutoffs = rules.missions.duration_class_cutoffs;
    expect(body.durationClass).toBe(expectedSeconds <= (cutoffs.fast ?? 0) ? 'fast' : 'medium');

    const serverMs = Date.parse(body.serverTime);
    const arrivalMs = Date.parse(body.arrivalAt);
    expect(Number.isNaN(serverMs)).toBe(false);
    expect(arrivalMs - serverMs).toBe(expectedSeconds * 1000);

    const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    expect(stored.status).toBe('IN_TRANSIT');
    expect(stored.arrivalAt?.toISOString()).toBe(body.arrivalAt);

    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    expect(ship.status).toBe('ON_MISSION');
    expect(ship.currentLocationId).toBe('ceres');

    const presence = await prisma.$queryRaw<
      Array<{ legIndex: number; lo: Date; hi: Date; routeId: string }>
    >`
      SELECT "legIndex", lower("window") AS "lo", upper("window") AS "hi", "routeId"
      FROM "RoutePresence"
      WHERE "missionId" = ${mission.id}
      ORDER BY "legIndex"
    `;
    expect(presence).toHaveLength(2);
    expect(presence[0]?.legIndex).toBe(0);
    expect(presence[1]?.legIndex).toBe(1);
    // 30/40 of the trip on leg 0, 10/40 on leg 1: contiguous and spanning [serverTime, arrivalAt].
    expect(Math.abs(presence[0]!.lo.getTime() - serverMs)).toBeLessThan(2000);
    expect(presence[0]!.hi.getTime()).toBe(presence[1]!.lo.getTime());
    expect(Math.abs(presence[1]!.hi.getTime() - arrivalMs)).toBeLessThan(2000);
    expect(Math.abs(presence[0]!.hi.getTime() - (serverMs + expectedSeconds * 750))).toBeLessThan(
      2000,
    );
    expect(presence[0]?.routeId).toBe(
      (mission.legs as unknown as Array<{ routeId: string }>)[0]?.routeId,
    );

    const job = await queue.getJob(mission.id);
    expect(job).toBeDefined();
    expect(job?.opts.jobId).toBe(mission.id);
    expect(job?.name).toBe('resolve');
    expect(job?.data as { missionId: string }).toMatchObject({ missionId: mission.id });
    const snapshot = (job?.data as { snapshot: { parts: unknown[]; legs: unknown[] } }).snapshot;
    expect(snapshot.parts.length).toBeGreaterThan(0);
    expect(snapshot.legs).toHaveLength(2);
  });

  // Owner debug switch (playtest round 2): the displayed duration and arrivalAt stay the real,
  // computed ones; only the queued job's actual delay is capped.
  it("a player's own debugFastOps shortens the queued delay without touching the displayed duration, and leaves other players alone", async () => {
    await freshSeededApp();
    await prisma.gameConfig.update({
      where: { key: 'admin.debug_fast_ops_seconds' },
      data: { value: 5 },
    });
    await configService.refresh();
    try {
      const player = await onboardPlayer();
      const other = await onboardPlayer();
      await prisma.player.update({
        where: { id: player.seeded.player.id },
        data: { debugFastOps: true },
      });
      const mission = await createMission(player, [750, 250]);
      const otherMission = await createMission(other, [750, 250]);
      const serverTime = new Date();
      const response = await request(httpServer(testApp.app))
        .post(`/v1/ships/${player.shipId}/dispatch`)
        .set(auth(player.token))
        .send({ missionId: mission.id });
      expect(response.status).toBe(200);
      const body = response.body as { arrivalAt: string };
      const realDelayMs = new Date(body.arrivalAt).getTime() - serverTime.getTime();
      // A fresh delivery mission's real trip is well over 5 seconds; the displayed figure is
      // untouched by the debug switch.
      expect(realDelayMs).toBeGreaterThan(5000);

      const job = await queue.getJob(mission.id);
      expect(job).toBeDefined();
      expect(job?.opts.delay).toBeLessThanOrEqual(5000);

      // The other player's own dispatch is untouched: no global switch was flipped.
      const otherResponse = await request(httpServer(testApp.app))
        .post(`/v1/ships/${other.shipId}/dispatch`)
        .set(auth(other.token))
        .send({ missionId: otherMission.id });
      expect(otherResponse.status).toBe(200);
      const otherJob = await queue.getJob(otherMission.id);
      expect(otherJob?.opts.delay).toBeGreaterThan(5000);
    } finally {
      await configService.refresh();
    }
  });

  // S10.7: the transit screen counts down per leg against the windows the server
  // computed at dispatch (pro-rata split of [serverTime, arrivalAt] by leg distance).
  it('exposes per-leg windows on GET /v1/missions/active: none before dispatch, contiguous after', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [30, 10]);
    const server = httpServer(testApp.app);

    const before = await request(server).get('/v1/missions/active').set(auth(player.token));
    expect(before.status).toBe(200);
    const acceptedRows = before.body as Array<{ id: string; legWindows: unknown[] }>;
    expect(acceptedRows).toHaveLength(1);
    expect(acceptedRows[0]!.id).toBe(mission.id);
    expect(acceptedRows[0]!.legWindows).toEqual([]);

    const dispatched = await dispatch(player.token, player.shipId, mission.id);
    expect(dispatched.status).toBe(200);
    const arrivalMs = Date.parse((dispatched.body as { arrivalAt: string }).arrivalAt);

    const active = await request(server).get('/v1/missions/active').set(auth(player.token));
    expect(active.status).toBe(200);
    const windows = (
      active.body as Array<{
        id: string;
        legWindows: Array<{ legIndex: number; routeId: string; from: string; to: string }>;
      }>
    )[0]!.legWindows;
    expect(windows).toHaveLength(2);
    expect(windows[0]!.legIndex).toBe(0);
    expect(windows[1]!.legIndex).toBe(1);

    const from0 = Date.parse(windows[0]!.from);
    const to0 = Date.parse(windows[0]!.to);
    const from1 = Date.parse(windows[1]!.from);
    const to1 = Date.parse(windows[1]!.to);
    expect(from0).toBeLessThan(to0);
    // Contiguous: leg 0 hands off to leg 1, and the last leg lands on arrivalAt.
    expect(to0).toBe(from1);
    expect(Math.abs(to1 - arrivalMs)).toBeLessThan(1000);
    // 30/40 of the trip on leg 0.
    const serverMs = Date.parse((dispatched.body as { serverTime: string }).serverTime);
    const durationMs = arrivalMs - serverMs;
    expect(Math.abs(to0 - (serverMs + (durationMs * 30) / 40))).toBeLessThan(2000);
  });

  it('is idempotent: a repeat dispatch replays the stored arrival and adds no new state', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [40]);
    const first = await dispatch(player.token, player.shipId, mission.id);
    expect(first.status).toBe(200);

    const presenceBefore = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "RoutePresence" WHERE "missionId" = ${mission.id}
    `;
    const second = await dispatch(player.token, player.shipId, mission.id);
    expect(second.status).toBe(200);
    expect((second.body as { arrivalAt: string }).arrivalAt).toBe(
      (first.body as { arrivalAt: string }).arrivalAt,
    );

    const presenceAfter = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "RoutePresence" WHERE "missionId" = ${mission.id}
    `;
    expect(presenceAfter.map((row) => row.id)).toEqual(presenceBefore.map((row) => row.id));
    const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    expect(stored.status).toBe('IN_TRANSIT');
  });

  it('rejects dispatch when the ship left the mission origin after accepting', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [40]);
    await prisma.ship.update({
      where: { id: player.shipId },
      data: { currentLocationId: 'hedus' },
    });

    const response = await dispatch(player.token, player.shipId, mission.id);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_NOT_AT_ORIGIN' },
    });
  });

  it('rejects dispatch while the ship is not in port', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [40]);
    await prisma.ship.update({ where: { id: player.shipId }, data: { status: 'ADRIFT' } });

    const response = await dispatch(player.token, player.shipId, mission.id);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'SHIP_NOT_IN_PORT' },
    });
  });

  it('rejects a chemical ship with an empty tank (GDD §7 balance 3)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [40]);
    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 0 } });

    const response = await dispatch(player.token, player.shipId, mission.id);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ statusCode: 409, message: { error: 'FUEL_EMPTY' } });
  });

  it('re-checks viability at dispatch time', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [40]);
    await prisma.partInstance.updateMany({
      where: { shipId: player.shipId, ownerPlayerId: player.seeded.player.id },
      data: { location: 'INVENTORY', shipId: null },
    });

    const response = await dispatch(player.token, player.shipId, mission.id);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      statusCode: 400,
      message: { error: 'SHIP_NOT_VIABLE' },
    });
    expect(
      (response.body as { message: { problems: unknown[] } }).message.problems.length,
    ).toBeGreaterThan(0);
  });

  it('rejects a mission that is not accepted and another player’s mission', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const available = await createAvailableMission();

    const notAccepted = await dispatch(player.token, player.shipId, available.id);
    expect(notAccepted.status).toBe(409);
    expect(notAccepted.body).toMatchObject({
      statusCode: 409,
      message: { error: 'MISSION_NOT_ACCEPTED' },
    });

    const mission = await createMission(player, [40]);
    const other = await onboardPlayer();
    const foreign = await dispatch(other.token, other.shipId, mission.id);
    expect(foreign.status).toBe(404);
  });

  it('rejects dispatching with a ship different from the one that accepted', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [40]);
    const secondShip = await prisma.ship.create({
      data: {
        ownerPlayerId: player.seeded.player.id,
        name: 'spare',
        layout: {},
        currentLocationId: 'ceres',
      },
    });

    const response = await dispatch(player.token, secondShip.id, mission.id);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ statusCode: 409, message: { error: 'SHIP_MISMATCH' } });
  });

  it('rejects another player’s ship with 403 and a missing token with 401', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [40]);
    const other = await onboardPlayer();

    const foreign = await dispatch(other.token, player.shipId, mission.id);
    expect(foreign.status).toBe(403);

    const anonymous = await request(httpServer(testApp.app))
      .post(`/v1/ships/${player.shipId}/dispatch`)
      .send({ missionId: mission.id });
    expect(anonymous.status).toBe(401);
  });

  it('dispatches even when the job enqueue fails, leaving a reconcilable mission', async () => {
    await freshSeededApp();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getQueueToken(MISSION_QUEUE_NAME))
      .useValue({
        add: () => Promise.reject(new Error('redis down')),
      })
      .compile();
    const app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app, app.get(EnvService));
    await app.init();

    try {
      await app.get(GameConfigService).refresh();
      const player = await authFor(app);
      const mission = await createMission(player, [40]);

      const response = await request(httpServer(app))
        .post(`/v1/ships/${player.shipId}/dispatch`)
        .set(auth(player.token))
        .send({ missionId: mission.id });
      expect(response.status).toBe(200);

      const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
      expect(stored.status).toBe('IN_TRANSIT');
      expect(stored.arrivalAt).not.toBeNull();
      const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
      expect(ship.status).toBe('ON_MISSION');
    } finally {
      await app.close();
    }
  });
});
