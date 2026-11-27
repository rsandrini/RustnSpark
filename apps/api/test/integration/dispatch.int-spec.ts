import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
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
import { GAME_CONFIG_DEFAULTS } from '../../src/config/game-config.defaults.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { MISSION_QUEUE_NAME } from '../../src/jobs/queues.js';
import { configureApp } from '../../src/main.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer, type SeededPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';
import type { ConnectorLayout } from '../../src/parts/connectors.js';
import type { Placement } from '../../src/parts/part.types.js';
import { pickCatalogStats } from '../../src/parts/parts.service.js';
import { directionErrors } from '../../src/ships/direction.js';
import { conductiveCatalog } from '../../src/ships/connectivity.js';
import { connectedPartIds, incorrectPortPartIds } from '../../src/ships/geometry.js';

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
    const mission = await createMission(player, [75, 25]);

    const shipResponse = await request(httpServer(testApp.app))
      .get(`/v1/ships/${player.shipId}`)
      .set(auth(player.token));
    expect(shipResponse.status).toBe(200);
    const mob = (shipResponse.body as { sheet: { mob: number } }).sheet.mob;
    const { rules } = configService.snapshot();
    // a 100-unit trip is a very short one (but not under the pad exemption): it takes at least the short-trip minimum
    const flown = Math.round((100 / mob) * rules.missions.duration_k);
    const expectedSeconds =
      Math.max(flown, rules.missions.short_trip_min_seconds) * rules.missions.time_scale;

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

  // Item 6 (v0.1.3): the card said about 1h30m for a mission that took 19 minutes. The card the pilot
  // sees on an accepted mission (GET /v1/missions/active -> info.estimate) must say what the dispatch
  // then plans, for a plain ship, for engines pushed past 1 and for a much faster ship.
  describe('the card and the dispatch plan the same trip (item 6)', () => {
    const cardAndPlan = async (
      player: AuthPair,
      legDistances: readonly number[],
    ): Promise<{
      card: { durationSeconds: number; fuelNeeded: number };
      planned: number;
      auditFuel: number;
    }> => {
      const mission = await createMission(player, legDistances);
      const active = await request(httpServer(testApp.app))
        .get('/v1/missions/active')
        .set(auth(player.token));
      const row = (
        active.body as Array<{
          id: string;
          info: { estimate: { durationSeconds: number; fuelNeeded: number } };
        }>
      ).find((entry) => entry.id === mission.id)!;
      const response = await dispatch(player.token, player.shipId, mission.id);
      expect(response.status).toBe(200);
      const audit = await prisma.playerEvent.findFirstOrThrow({
        where: { playerId: player.seeded.player.id, type: 'mission.dispatch' },
        orderBy: { at: 'desc' },
      });
      return {
        card: row.info.estimate,
        planned: (response.body as { durationSeconds: number }).durationSeconds,
        auditFuel: (audit.payload as { fuelNeeded: number }).fuelNeeded,
      };
    };

    it('a plain ship: the card time and fuel are the dispatch time and fuel', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 5000 } });
      const { card, planned, auditFuel } = await cardAndPlan(player, [900, 700]);
      expect(Math.abs(card.durationSeconds - planned)).toBeLessThanOrEqual(1);
      expect(Math.round(card.fuelNeeded)).toBe(auditFuel);
    });

    it("engines pushed past 1: the card follows the pilot's levels like the dispatch", async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      await prisma.ship.update({
        where: { id: player.shipId },
        data: { fuel: 5000, chemLevel: 1.4, ionLevel: 1.6 },
      });
      const { card, planned, auditFuel } = await cardAndPlan(player, [900, 700]);
      expect(Math.abs(card.durationSeconds - planned)).toBeLessThanOrEqual(1);
      expect(Math.round(card.fuelNeeded)).toBe(auditFuel);
    });

    it('an engine blocked by another part gives no thrust at dispatch: the card says so too', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 5000 } });
      // A second engine, so that blocking one still leaves the ship able to fly.
      const extra = await prisma.partInstance.create({
        data: {
          partType: 'engine_chem_small',
          ownerPlayerId: player.seeded.player.id,
          condition: 100,
          location: 'INVENTORY',
        },
      });
      const placed = await prisma.partInstance.findMany({
        where: { shipId: player.shipId, location: 'INSTALLED' },
        select: { id: true },
      });
      const assembled = await request(httpServer(testApp.app))
        .post(`/v1/ships/${player.shipId}/auto-assemble`)
        .set(auth(player.token))
        .send({ partInstanceIds: [...placed.map((part) => part.id), extra.id] });
      expect(assembled.status).toBe(200);
      // Park a part right in front of an engine's exhaust (a layout warning, the ship still flies).
      const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
      const rows = await prisma.partInstance.findMany({
        where: { shipId: player.shipId, location: 'INSTALLED' },
        include: { partCatalog: true },
      });
      const catalog = new Map(rows.map((row) => [row.id, pickCatalogStats(row.partCatalog)]));
      const connectors = new Map(
        rows.map((row) => [row.id, row.connectors as ConnectorLayout | null]),
      );
      const installedForConnectivity = rows.map((row) => ({
        instance: row,
        catalog: pickCatalogStats(row.partCatalog),
      }));
      const layout = ship.layout as unknown as Placement[];
      const movable = layout.filter(
        (placement) => catalog.get(placement.partInstanceId)?.partClass !== 'BRIDGE',
      );
      let blocked: Placement[] | undefined;
      // Search a small neighbourhood for a move or turn that blocks an exhaust and still leaves every
      // part connected with matching ports (a warning, not a grounded ship).
      for (const mover of movable) {
        for (let gx = -3; gx <= 3 && blocked === undefined; gx += 1) {
          for (let gy = -3; gy <= 3 && blocked === undefined; gy += 1) {
            for (const rot of [0, 90, 180, 270]) {
              const trial = layout.map((placement) =>
                placement.partInstanceId === mover.partInstanceId
                  ? { ...placement, gx, gy, rot }
                  : placement,
              );
              const sameCell =
                new Set(trial.map((entry) => `${entry.gx},${entry.gy}`)).size !== trial.length;
              if (
                !sameCell &&
                directionErrors(trial, catalog, connectors).some(
                  (e) => e.code === 'EXHAUST_BLOCKED',
                ) &&
                incorrectPortPartIds(trial, catalog, connectors).size === 0 &&
                connectedPartIds(
                  trial,
                  conductiveCatalog(catalog, installedForConnectivity, GAME_CONFIG_DEFAULTS),
                  connectors,
                ).size === trial.length
              ) {
                blocked = trial;
                break;
              }
            }
          }
        }
        if (blocked !== undefined) break;
      }
      expect(blocked).toBeDefined();
      await prisma.ship.update({
        where: { id: player.shipId },
        data: { layout: blocked as unknown as Prisma.InputJsonValue },
      });
      const { card, planned, auditFuel } = await cardAndPlan(player, [900, 700]);
      expect(Math.abs(card.durationSeconds - planned)).toBeLessThanOrEqual(1);
      expect(Math.round(card.fuelNeeded)).toBe(auditFuel);
    });

    it('a much faster ship (engines 6x thrust): the card is not minutes off the plan', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 5000 } });
      await prisma.$executeRaw`UPDATE "PartCatalog" SET "pot" = "pot" * 6 WHERE "pot" > 0`;
      const { card, planned, auditFuel } = await cardAndPlan(player, [2500, 1500, 1000]);
      expect(Math.abs(card.durationSeconds - planned)).toBeLessThanOrEqual(1);
      expect(Math.round(card.fuelNeeded)).toBe(auditFuel);
    });
  });

  // S10.7: the transit screen counts down per leg against the windows the server
  // computed at dispatch (pro-rata split of [serverTime, arrivalAt] by leg distance).
  it('an accepted mission keeps the board card details on GET /v1/missions/active (time, fuel, requirements)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [30, 10]);
    const response = await request(httpServer(testApp.app))
      .get('/v1/missions/active')
      .set(auth(player.token));
    expect(response.status).toBe(200);
    const [row] = response.body as Array<{ id: string; info?: Record<string, unknown> }>;
    expect(row!.id).toBe(mission.id);
    expect(row!.info).toMatchObject({
      legCount: 2,
      totalDistance: 40,
      estimate: { durationSeconds: expect.any(Number), fuelNeeded: expect.any(Number) },
      requirements: expect.any(Array),
    });
  });

  describe('GET /v1/missions/active eligibility of the accepted mission', () => {
    type ActiveRow = {
      id: string;
      eligibility?: { eligible: boolean; reasons: Array<{ code: string; message: string }> };
      info?: { requirements: Array<{ met: boolean }> };
    };
    async function activeRow(player: AuthPair): Promise<ActiveRow> {
      const response = await request(httpServer(testApp.app))
        .get('/v1/missions/active')
        .set(auth(player.token));
      expect(response.status).toBe(200);
      return (response.body as ActiveRow[])[0]!;
    }

    it('active returns eligible: true for an accepted mission the ship qualifies for', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      await createMission(player, [30, 10]);
      const row = await activeRow(player);
      expect(row.eligibility).toEqual({ eligible: true, reasons: [] });
    });

    it('a part change that breaks the requirement flips it to eligible: false, and back', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      const mission = await createMission(player, [30, 10]);
      const original = await prisma.missionTemplate.findUniqueOrThrow({
        where: { id: mission.templateId },
      });
      await prisma.missionTemplate.update({
        where: { id: mission.templateId },
        data: { requirements: { cargo: 100000 } },
      });
      const broken = await activeRow(player);
      expect(broken.eligibility!.eligible).toBe(false);
      expect(broken.eligibility!.reasons.map((reason) => reason.code)).toContain('CARGO_TYPE');
      expect(broken.eligibility!.reasons.map((reason) => reason.code)).not.toContain(
        'ACTIVE_MISSION_EXISTS',
      );
      expect(broken.eligibility!.reasons.map((reason) => reason.code)).not.toContain(
        'SHIP_NOT_AT_ORIGIN',
      );
      expect(broken.info!.requirements.some((entry) => entry.met === false)).toBe(true);

      await prisma.missionTemplate.update({
        where: { id: mission.templateId },
        data: { requirements: original.requirements ?? {} },
      });
      const restored = await activeRow(player);
      expect(restored.eligibility).toEqual({ eligible: true, reasons: [] });
    });

    it('an IN_TRANSIT mission has no eligibility', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      const mission = await createMission(player, [40]);
      const sent = await dispatch(player.token, player.shipId, mission.id);
      expect(sent.status).toBe(200);
      const row = await activeRow(player);
      expect(row.id).toBe(mission.id);
      expect(row.eligibility).toBeUndefined();
    });
  });

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

  // The offer's clock keeps running after accept (design ux §7): accept() already refuses an
  // expired AVAILABLE/HELD offer, but a pilot who accepted before the deadline and dispatched
  // after it used to get through — dispatch re-checks both clocks server-side.
  it('rejects dispatch of an accepted mission whose offer has expired, and flips it to EXPIRED', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [40]);
    await prisma.missionInstance.update({
      where: { id: mission.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const response = await dispatch(player.token, player.shipId, mission.id);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'MISSION_EXPIRED' },
    });
    // The row never sits as a stale ACCEPTED: it is released back to the board's expiry state.
    const after = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    expect(after.status).toBe('EXPIRED');
    expect(after.playerId).toBeNull();
    // The ship never left port.
    expect((await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } })).status).toBe(
      'IN_PORT',
    );
  });

  it('rejects dispatch past the mission start deadline (deadlineAt), even with offer time left', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [40]);
    await prisma.missionInstance.update({
      where: { id: mission.id },
      data: { deadlineAt: new Date(Date.now() - 60_000) },
    });

    const response = await dispatch(player.token, player.shipId, mission.id);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'MISSION_EXPIRED' },
    });
    const after = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    expect(after.status).toBe('EXPIRED');
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

  it('rejects a route the tank cannot cover: it would end adrift every time', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [4000, 4000]);
    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 5 } });

    const response = await dispatch(player.token, player.shipId, mission.id);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: { error: 'FUEL_INSUFFICIENT', have: 5 },
    });
    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    expect(ship.status).toBe('IN_PORT');
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

  it('a ship with no bridge cannot dispatch (NO_BRIDGE): nothing leaves port, the mission stays accepted', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [40]);
    // take only the bridge out of the ship: every other part stays installed
    const installed = await prisma.partInstance.findMany({
      where: { shipId: player.shipId, ownerPlayerId: player.seeded.player.id },
      include: { partCatalog: true },
    });
    const bridge = installed.find((part) => part.partCatalog.partClass === 'BRIDGE');
    expect(bridge).toBeDefined();
    await prisma.partInstance.update({
      where: { id: bridge!.id },
      data: { location: 'INVENTORY', shipId: null },
    });
    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    const layout = (ship.layout as Array<{ partInstanceId: string }>).filter(
      (placement) => placement.partInstanceId !== bridge!.id,
    );
    await prisma.ship.update({ where: { id: player.shipId }, data: { layout } });

    const response = await dispatch(player.token, player.shipId, mission.id);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ message: { error: 'SHIP_NOT_VIABLE' } });
    const problems = (response.body as { message: { problems: Array<{ code: string }> } }).message
      .problems;
    expect(problems.map((problem) => problem.code)).toContain('NO_BRIDGE');

    const after = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    expect(after.status).toBe('IN_PORT');
    const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    expect(stored.status).toBe('ACCEPTED');
    expect(await queue.getJob(mission.id)).toBeFalsy();
  });

  it('refuses a ship with more spare parts than the bridge has slots for, however small they are', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [40]);
    const slots = GAME_CONFIG_DEFAULTS.ship.spare_part_slots;
    await prisma.partInstance.createMany({
      data: Array.from({ length: slots + 1 }, () => ({
        partType: 'cargo',
        ownerPlayerId: player.seeded.player.id,
        condition: 100,
        location: 'INVENTORY' as const,
      })),
    });

    const refused = await dispatch(player.token, player.shipId, mission.id);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ message: { error: 'SHIP_NOT_VIABLE' } });
    const problems = (refused.body as { message: { problems: Array<{ code: string }> } }).message
      .problems;
    expect(problems.map((problem) => problem.code)).toContain('HOLD_PARTS_OVER');

    // one part fewer and the ship flies
    const extra = await prisma.partInstance.findFirstOrThrow({
      where: { ownerPlayerId: player.seeded.player.id, location: 'INVENTORY' },
    });
    await prisma.partInstance.delete({ where: { id: extra.id } });
    const ok = await dispatch(player.token, player.shipId, mission.id);
    expect(ok.status).toBe(200);
  });

  it('a fixed-cargo delivery fills the cargo space it asks for, and the ore ashore takes none', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [40]);
    // the starter hold is 5: a fixed load of 5 fills it
    await prisma.missionTemplate.update({
      where: { id: mission.templateId },
      data: { requirements: { cargo: 5, cargoMode: 'fixed' } },
    });
    // goods held ashore (ore, scrap) do not count against the hold
    await prisma.playerMaterial.create({
      data: { playerId: player.seeded.player.id, materialId: 'common_ore', quantity: 500 },
    });

    const ok = await dispatch(player.token, player.shipId, mission.id);
    expect(ok.status).toBe(200);
    const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    expect(stored.cargo).toMatchObject({ load: { mode: 'fixed', units: 5, need: 5 } });
  });

  it('a fixed load bigger than the cargo space is flown in trips, carrying what the hold takes', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [40]);
    await prisma.missionTemplate.update({
      where: { id: mission.templateId },
      data: { requirements: { cargo: 9, cargoMode: 'fixed' } },
    });
    const ok = await dispatch(player.token, player.shipId, mission.id);
    expect(ok.status).toBe(200);
    const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    // starter hold 5 of 9: two trips, and the load aboard never exceeds the hold
    expect(stored.cargo).toMatchObject({ load: { mode: 'fixed', units: 5, need: 9 } });
    // two trips: 2 * 2 - 1 = 3 times the single-trip time
    const event = await prisma.playerEvent.findFirstOrThrow({
      where: { playerId: player.seeded.player.id, type: 'mission.dispatch' },
    });
    expect((event.payload as { specialtyFactor: number }).specialtyFactor).toBe(3);
  });

  it('a load far above the cargo space (under the minimum share) cannot depart', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [40]);
    await prisma.missionTemplate.update({
      where: { id: mission.templateId },
      data: { requirements: { cargo: 100, cargoMode: 'fixed' } },
    });
    const refused = await dispatch(player.token, player.shipId, mission.id);
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ message: { error: 'MISSION_REQUIREMENTS_NOT_MET' } });
    const reasons = (refused.body as { message: { reasons: Array<{ code: string }> } }).message
      .reasons;
    expect(reasons.map((reason) => reason.code)).toContain('CARGO_TYPE');
  });

  it('an open-cargo delivery loads the whole cargo space', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [40]);
    await prisma.missionTemplate.update({
      where: { id: mission.templateId },
      data: { requirements: { cargo: 2, cargoMode: 'open', unitPay: 30 } },
    });

    const ok = await dispatch(player.token, player.shipId, mission.id);
    expect(ok.status).toBe(200);
    const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    // starter hold 5: 5 units loaded, 3 of them beyond the minimum
    expect(stored.cargo).toMatchObject({ load: { mode: 'open', units: 5, need: 2, unitPay: 30 } });
  });

  it('a blocked engine does not ground the ship: it flies, with no thrust from that engine (slower)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    const mission = await createMission(player, [300, 300]);
    // The starter hull is heavy enough that the starter ship's rounded mobility sits on its floor of 1,
    // where a dead engine could not make it any slower: a light hull lifts it above the floor.
    await prisma.partCatalog.update({ where: { partType: 'hull' }, data: { mass: 2 } });
    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    const layout = ship.layout as { partInstanceId: string; gx: number; gy: number; rot: number }[];
    const engine = await prisma.partInstance.findFirstOrThrow({
      where: {
        id: { in: layout.map((placement) => placement.partInstanceId) },
        partCatalog: { partClass: 'ENGINE' },
      },
    });
    const healthy = await request(httpServer(testApp.app))
      .get(`/v1/ships/${player.shipId}`)
      .set(auth(player.token));
    const { rules } = configService.snapshot();
    const secondsAt = (mob: number): number =>
      Math.round((600 / mob) * rules.missions.duration_k) * rules.missions.time_scale;
    const healthySeconds = secondsAt((healthy.body as { sheet: { mob: number } }).sheet.mob);

    // Universal ports on the engine (so turning it never disconnects it), then turn it until the
    // part next to it plugs its exhaust: that is the only thing wrong — a warning, not a problem.
    await prisma.partInstance.update({
      where: { id: engine.id },
      data: { connectors: Prisma.DbNull },
    });
    let blocked = false;
    for (const rot of [0, 90, 180, 270]) {
      const candidate = layout.map((placement) =>
        placement.partInstanceId === engine.id ? { ...placement, rot } : placement,
      );
      const preview = await request(httpServer(testApp.app))
        .post(`/v1/ships/${player.shipId}/preview`)
        .set(auth(player.token))
        .send({ layout: candidate });
      const viability = (
        preview.body as { viability: { viable: boolean; warnings: { code: string }[] } }
      ).viability;
      if (viability.viable && viability.warnings.some((w) => w.code === 'EXHAUST_BLOCKED')) {
        await prisma.ship.update({ where: { id: player.shipId }, data: { layout: candidate } });
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);

    const response = await dispatch(player.token, player.shipId, mission.id);
    expect(response.status).toBe(200);
    const seconds = (response.body as { durationSeconds: number }).durationSeconds;
    expect(seconds).toBeGreaterThan(healthySeconds);
    // thrust 0 leaves mobility at its floor of 1
    expect(seconds).toBe(secondsAt(1));
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
  describe('dispatch follows the ship specialty', () => {
    async function acceptedOfType(
      player: AuthPair,
      type: 'TRANSPORT' | 'ESCORT',
      extra: { cargo?: unknown; danger?: number },
    ): Promise<MissionInstance> {
      const template = await prisma.missionTemplate.findFirstOrThrow({
        where: { type },
        orderBy: { id: 'asc' },
      });
      const route = await prisma.route.findFirstOrThrow({ orderBy: { id: 'asc' } });
      return prisma.missionInstance.create({
        data: {
          templateId: template.id,
          type,
          factionId: template.factionId,
          originId: 'ceres',
          destinationId: 'hedus',
          legs: [
            {
              routeId: route.id,
              distance: 40,
              danger: extra.danger ?? 1,
              zone: 0,
              env: { id: 'belt', level: 1, fuelMult: 1 },
            },
          ],
          cargo: extra.cargo ?? {},
          reward: 100,
          expiresAt: new Date(Date.now() + 30 * 60_000),
          seed: `spec-${randomUUID()}`,
          status: 'ACCEPTED',
          playerId: player.seeded.player.id,
          shipId: player.shipId,
          acceptedAt: new Date(),
        },
      });
    }

    async function giveCabin(player: AuthPair): Promise<void> {
      const installed = await prisma.partInstance.findFirstOrThrow({
        where: { shipId: player.shipId, ownerPlayerId: player.seeded.player.id },
        include: { partCatalog: true },
      });
      await prisma.partCatalog.update({
        where: { partType: installed.partCatalog.partType },
        data: { specialProp: { pressurized: true, lifeSupport: true, pax: 2, lifeCap: 2 } },
      });
      await configService.refresh();
    }

    interface DispatchAudit {
      plannedSeconds: number;
      quotedSeconds: number;
      specialtyFactor: number;
    }

    async function auditOf(player: AuthPair): Promise<DispatchAudit> {
      const event = await prisma.playerEvent.findFirstOrThrow({
        where: { playerId: player.seeded.player.id, type: 'mission.dispatch' },
      });
      return event.payload as unknown as DispatchAudit;
    }

    // A fresh world, a 2-seat ship, a transport of `passengers`: what the dispatch planned.
    async function transportPlan(
      passengers: number,
    ): Promise<{ seconds: number; arrivalMs: number; audit: DispatchAudit }> {
      await freshSeededApp();
      const player = await onboardPlayer();
      await giveCabin(player);
      const mission = await acceptedOfType(player, 'TRANSPORT', { cargo: { passengers } });
      const before = Date.now();
      const response = await dispatch(player.token, player.shipId, mission.id);
      expect(response.status).toBe(200);
      const body = response.body as { durationSeconds: number; arrivalAt: string };
      const arrivalMs = new Date(body.arrivalAt).getTime() - before;
      return { seconds: body.durationSeconds, arrivalMs, audit: await auditOf(player) };
    }

    it('dispatch plans the stretched time', async () => {
      const single = await transportPlan(2);
      const group = await transportPlan(4);

      expect(single.audit.specialtyFactor).toBe(1);
      expect(group.audit.specialtyFactor).toBe(3);
      // 4 on 2 seats is three legs of the same trip: exactly 3 times the planned time, and the arrival follows it
      expect(group.seconds).toBe(3 * single.seconds);
      expect(group.audit.plannedSeconds).toBe(3 * single.audit.plannedSeconds);
      expect(group.audit.plannedSeconds).toBe(group.audit.quotedSeconds);
      expect(Math.abs(group.arrivalMs - group.seconds * 1000)).toBeLessThan(5000);
    });

    it('the engine preview quotes the stretched time for the trip and its baseline', async () => {
      const previewOf = async (passengers: number) => {
        await freshSeededApp();
        const player = await onboardPlayer();
        await giveCabin(player);
        const mission = await acceptedOfType(player, 'TRANSPORT', { cargo: { passengers } });
        const response = await request(httpServer(testApp.app))
          .post(`/v1/ships/${player.shipId}/engine-preview`)
          .set(auth(player.token))
          .send({ missionId: mission.id });
        expect(response.status).toBe(200);
        return (
          response.body as {
            trip: { durationSeconds: number; baseline: { durationSeconds: number } };
          }
        ).trip;
      };
      const single = await previewOf(2);
      const group = await previewOf(4);
      expect(group.durationSeconds).toBe(3 * single.durationSeconds);
      expect(group.baseline.durationSeconds).toBe(3 * single.baseline.durationSeconds);
    });

    it('a weapon that faces a blocked side does not drop the stretch below what the check passed', async () => {
      // the starter kit's layout is random: try fresh ships until the weapon can be turned into a blocked side
      let player!: AuthPair;
      let weaponRow!: Awaited<
        ReturnType<typeof prisma.partInstance.findFirstOrThrow<{ include: { partCatalog: true } }>>
      >;
      let blocked: Placement[] | undefined;
      for (let attempt = 0; attempt < 8 && blocked === undefined; attempt += 1) {
        await freshSeededApp();
        player = await onboardPlayer();
        await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 5000 } });
        // a strong weapon and nothing else that fights: the ship meets the escort only through the weapon
        weaponRow = await prisma.partInstance.findFirstOrThrow({
          where: {
            shipId: player.shipId,
            ownerPlayerId: player.seeded.player.id,
            partCatalog: { partClass: 'WEAPON' },
          },
          include: { partCatalog: true },
        });
        await prisma.partCatalog.updateMany({ data: { esc: 0, bli: 0 } });
        // fast enough for an escort (it asks for mobility)
        await prisma.partCatalog.updateMany({
          where: { partClass: 'ENGINE' },
          data: { pot: 100_000 },
        });
        await prisma.partCatalog.update({
          where: { partType: weaponRow.partCatalog.partType },
          data: { pdf: 1_000_000 },
        });
        await configService.refresh();
        // turn the weapon so another part sits in front of it (a layout warning: the weapon loses its output)
        const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
        const rows = await prisma.partInstance.findMany({
          where: { shipId: player.shipId, location: 'INSTALLED' },
          include: { partCatalog: true },
        });
        const catalog = new Map(rows.map((row) => [row.id, pickCatalogStats(row.partCatalog)]));
        const connectors = new Map(
          rows.map((row) => [row.id, row.connectors as ConnectorLayout | null]),
        );
        const installedForConnectivity = rows.map((row) => ({
          instance: row,
          catalog: pickCatalogStats(row.partCatalog),
        }));
        const layout = ship.layout as unknown as Placement[];
        for (const mover of layout.filter(
          (placement) => catalog.get(placement.partInstanceId)?.partClass !== 'BRIDGE',
        )) {
          for (let gx = -4; gx <= 4 && blocked === undefined; gx += 1) {
            for (let gy = -4; gy <= 4 && blocked === undefined; gy += 1) {
              for (const rot of [0, 90, 180, 270]) {
                const trial = layout.map((placement) =>
                  placement.partInstanceId === mover.partInstanceId
                    ? { ...placement, gx, gy, rot }
                    : placement,
                );
                const sameCell =
                  new Set(trial.map((entry) => `${entry.gx},${entry.gy}`)).size !== trial.length;
                if (
                  !sameCell &&
                  directionErrors(trial, catalog, connectors).some(
                    (e) =>
                      e.partInstanceId === weaponRow.id &&
                      (e.code === 'FACING_BLOCKED' || e.code === 'FACING_CONNECTOR'),
                  ) &&
                  directionErrors(trial, catalog, connectors).every(
                    (e) => e.code === 'FACING_BLOCKED' || e.code === 'FACING_CONNECTOR',
                  ) &&
                  incorrectPortPartIds(trial, catalog, connectors).size === 0 &&
                  connectedPartIds(
                    trial,
                    conductiveCatalog(catalog, installedForConnectivity, GAME_CONFIG_DEFAULTS),
                    connectors,
                  ).size === trial.length
                ) {
                  blocked = trial;
                  break;
                }
              }
            }
          }
          if (blocked !== undefined) break;
        }
      }
      expect(blocked).toBeDefined();
      await prisma.ship.update({
        where: { id: player.shipId },
        data: { layout: blocked as unknown as Prisma.InputJsonValue },
      });
      const mission = await acceptedOfType(player, 'ESCORT', {});

      const response = await dispatch(player.token, player.shipId, mission.id);
      expect(response.status).toBe(200);
      const audit = await auditOf(player);
      // the check passed on the connected parts (strong weapon): the stretch is the strong ship's (the fastest
      // factor), not the cliff back to 1 that the penalised flight sheet would give; plan and quote agree
      expect(audit.specialtyFactor).toBe(GAME_CONFIG_DEFAULTS.specialty.escort.fastest);
      expect(audit.plannedSeconds).toBe(audit.quotedSeconds);
    }, 90_000);

    it('dispatch re-checks the specialty', async () => {
      // the starter layout is random: a fresh ship whose shield can leave without cutting a part off
      let response!: request.Response;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await freshSeededApp();
        const player = await onboardPlayer();
        // the starter weapon is made weak and the hold stands in for a strong shield (it is not the bridge or an engine)
        const weapon = await prisma.partInstance.findFirstOrThrow({
          where: {
            shipId: player.shipId,
            ownerPlayerId: player.seeded.player.id,
            partCatalog: { partClass: 'WEAPON' },
          },
          include: { partCatalog: true },
        });
        const other = await prisma.partInstance.findFirstOrThrow({
          where: {
            shipId: player.shipId,
            ownerPlayerId: player.seeded.player.id,
            partCatalog: { crg: { gt: 0 } },
          },
          include: { partCatalog: true },
        });
        await prisma.partCatalog.update({
          where: { partType: weapon.partCatalog.partType },
          data: { pdf: 1 },
        });
        await prisma.partCatalog.update({
          where: { partType: other.partCatalog.partType },
          data: { esc: 1_000_000 },
        });
        await configService.refresh();
        const mission = await acceptedOfType(player, 'ESCORT', {});

        // the shield leaves the ship in port, after accept
        await prisma.partInstance.update({
          where: { id: other.id },
          data: { location: 'INVENTORY', shipId: null },
        });
        response = await dispatch(player.token, player.shipId, mission.id);
        const error = (response.body as { message?: { error?: string } }).message?.error;
        if (error !== 'SHIP_NOT_VIABLE') break;
      }
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ message: { error: 'MISSION_REQUIREMENTS_NOT_MET' } });
      const codes = (
        response.body as { message: { reasons: Array<{ code: string }> } }
      ).message.reasons.map((reason) => reason.code);
      expect(codes).toContain('ESCORT_STRENGTH');
    }, 90_000);
  });

  describe('an explore dispatch plans the scan (the card, the plan and the stage agree)', () => {
    // The starter kit gets a radar of `sen` (the catalog row is made to read that), assembled into the ship.
    async function giveRadar(player: AuthPair, sen: number): Promise<{ id: string }> {
      await prisma.partCatalog.update({ where: { partType: 'sensor_radar' }, data: { sen } });
      await configService.refresh();
      const radar = await prisma.partInstance.create({
        data: {
          partType: 'sensor_radar',
          ownerPlayerId: player.seeded.player.id,
          condition: 100,
          location: 'INVENTORY',
        },
      });
      const placed = await prisma.partInstance.findMany({
        where: { shipId: player.shipId, location: 'INSTALLED' },
        select: { id: true },
      });
      const assembled = await request(httpServer(testApp.app))
        .post(`/v1/ships/${player.shipId}/auto-assemble`)
        .set(auth(player.token))
        .send({ partInstanceIds: [...placed.map((part) => part.id), radar.id] });
      expect(assembled.status).toBe(200);
      return radar;
    }

    async function exploreMission(player: AuthPair, area: number): Promise<MissionInstance> {
      const template = await prisma.missionTemplate.findFirstOrThrow({
        where: { type: 'EXPLORE' },
        orderBy: { id: 'asc' },
      });
      const route = await prisma.route.findFirstOrThrow({ orderBy: { id: 'asc' } });
      return prisma.missionInstance.create({
        data: {
          templateId: template.id,
          type: 'EXPLORE',
          factionId: template.factionId,
          originId: 'ceres',
          destinationId: 'hedus',
          legs: [
            {
              routeId: route.id,
              distance: 40,
              danger: 1,
              zone: 0,
              env: { id: 'belt', level: 1, fuelMult: 1 },
            },
          ],
          cargo: { area },
          reward: 100,
          expiresAt: new Date(Date.now() + 30 * 60_000),
          seed: `explore-${randomUUID()}`,
          status: 'ACCEPTED',
          playerId: player.seeded.player.id,
          shipId: player.shipId,
          acceptedAt: new Date(),
        },
      });
    }

    async function cardOf(
      player: AuthPair,
      missionId: string,
    ): Promise<{ durationSeconds: number; fuelNeeded: number; flightSeconds: number }> {
      const active = await request(httpServer(testApp.app))
        .get('/v1/missions/active')
        .set(auth(player.token));
      const row = (
        active.body as Array<{
          id: string;
          info: {
            estimate: { durationSeconds: number; fuelNeeded: number; flightSeconds: number };
          };
        }>
      ).find((entry) => entry.id === missionId)!;
      return row.info.estimate;
    }

    it('dispatch adds scan time and fuel', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      await giveRadar(player, 4);
      await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 5000 } });
      const mission = await exploreMission(player, 60);
      const unscaled = await cardOf(player, mission.id);
      // a game speed other than 1 stretches the flight only: the scan must not go through it
      const setTimeScale = async (value: number): Promise<void> => {
        await prisma.gameConfig.update({ where: { key: 'missions.time_scale' }, data: { value } });
        await configService.refresh();
      };
      await setTimeScale(2);
      let card: Awaited<ReturnType<typeof cardOf>>;
      let response: request.Response;
      try {
        card = await cardOf(player, mission.id);
        response = await dispatch(player.token, player.shipId, mission.id);
      } finally {
        await setTimeScale(GAME_CONFIG_DEFAULTS.missions.time_scale);
      }

      expect(response.status).toBe(200);
      const planned = (response.body as { durationSeconds: number }).durationSeconds;
      expect(card.flightSeconds).toBe(2 * unscaled.flightSeconds);
      // the scan (10 ticks of 300 s) comes after the time scale: exactly 3000 s on top of the flight
      expect(planned).toBe(card.flightSeconds + 3000);
      expect(card.durationSeconds).toBe(planned);

      const row = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
      const legs = row.legs as Array<{ scanTicks?: number }>;
      expect(legs[legs.length - 1]!.scanTicks).toBe(10);
      expect((row.cargo as { scanSeconds?: number }).scanSeconds).toBe(3000);
      expect(row.arrivalAt!.getTime() - Date.now()).toBeLessThanOrEqual(planned * 1000 + 2000);
    });

    it('a ship with too little fuel for the trip plus the scan is refused', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      await giveRadar(player, 4);
      await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 5000 } });
      const mission = await exploreMission(player, 60);
      const card = await cardOf(player, mission.id);
      // the scan burns 10 ticks x 25: leave the trip and a little, not the scan
      const tripFuel = card.fuelNeeded - 250;
      const aboard = tripFuel + 100;
      await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: aboard } });
      const response = await dispatch(player.token, player.shipId, mission.id);
      expect(response.status).toBe(409);
      // `needed` counts the scan: the trip-only check (which this ship passes) would not report it
      expect(response.body).toMatchObject({
        message: {
          error: 'FUEL_INSUFFICIENT',
          needed: Math.ceil(tripFuel + 250),
          have: Math.floor(aboard),
        },
      });
    });

    it('the engine preview quotes the same time and fuel as the card, scan included', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      await giveRadar(player, 4);
      const levels = { chem: 1.4, ion: 1.6 };
      await prisma.ship.update({
        where: { id: player.shipId },
        data: { fuel: 5000, chemLevel: levels.chem, ionLevel: levels.ion },
      });
      const mission = await exploreMission(player, 60);
      const card = await cardOf(player, mission.id);

      const response = await request(httpServer(testApp.app))
        .post(`/v1/ships/${player.shipId}/engine-preview`)
        .set(auth(player.token))
        .send({ ...levels, missionId: mission.id });
      expect(response.status).toBe(200);
      const { trip } = response.body as {
        trip: { durationSeconds: number; fuelNeeded: number };
      };
      expect(trip.durationSeconds).toBe(card.durationSeconds);
      expect(trip.fuelNeeded).toBeCloseTo(card.fuelNeeded, 6);
    });

    it('the dispatch audit measures drift on the flight alone and logs the scan', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      await giveRadar(player, 4);
      await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 5000 } });
      const mission = await exploreMission(player, 60);
      const response = await dispatch(player.token, player.shipId, mission.id);
      expect(response.status).toBe(200);
      const audit = await prisma.playerEvent.findFirstOrThrow({
        where: { playerId: player.seeded.player.id, type: 'mission.dispatch' },
      });
      expect(audit.payload).toMatchObject({ driftPct: 0, scanSeconds: 3000 });
    });

    it('dispatch re-checks the radar', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      const radar = await giveRadar(player, 4);
      await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 5000 } });
      const mission = await exploreMission(player, 60);
      await prisma.partInstance.update({
        where: { id: radar.id },
        data: { location: 'INVENTORY', shipId: null },
      });
      const response = await dispatch(player.token, player.shipId, mission.id);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ message: { error: 'MISSION_REQUIREMENTS_NOT_MET' } });
      const codes = (
        response.body as { message: { reasons: Array<{ code: string }> } }
      ).message.reasons.map((reason) => reason.code);
      expect(codes).toContain('SENSOR_STRENGTH');
    });

    it('ship activity: flying then scanning', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      await giveRadar(player, 4);
      await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 5000 } });
      const mission = await exploreMission(player, 60);
      const response = await dispatch(player.token, player.shipId, mission.id);
      expect(response.status).toBe(200);
      const row = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
      const ships = await request(httpServer(testApp.app)).get('/v1/ships').set(auth(player.token));
      const activity = (
        ships.body as Array<{
          activity: { kind: string; flightUntil: string | null; flightThen?: string };
        }>
      )[0]!.activity;
      expect(activity.kind).toBe('flying');
      expect(activity.flightThen).toBe('scanning');
      expect(new Date(activity.flightUntil!).getTime()).toBe(row.arrivalAt!.getTime() - 3000_000);
    });
  });

  describe('dispatch re-checks the mission requirements (slice 0.1)', () => {
    type Reason = { code: string };

    async function missionOfType(
      player: AuthPair,
      type: 'RACE' | 'DELIVERY' | 'TRANSPORT' | 'MINING' | 'TRAVEL' | 'SCAVENGE',
      status: 'ACCEPTED' | 'AVAILABLE' = 'ACCEPTED',
    ): Promise<MissionInstance> {
      const template = await prisma.missionTemplate.findFirstOrThrow({
        where: { type },
        orderBy: { id: 'asc' },
      });
      const route = await prisma.route.findFirstOrThrow({ orderBy: { id: 'asc' } });
      const accepted = status === 'ACCEPTED';
      return prisma.missionInstance.create({
        data: {
          templateId: template.id,
          type,
          factionId: template.factionId,
          originId: 'ceres',
          destinationId: 'hedus',
          legs: [
            {
              routeId: route.id,
              distance: 40,
              danger: 1,
              zone: 0,
              env: { id: 'belt', level: 1, fuelMult: 1 },
            },
          ],
          cargo: {},
          reward: 100,
          expiresAt: new Date(Date.now() + 30 * 60_000),
          seed: `s0.1-${randomUUID()}`,
          status,
          ...(accepted
            ? {
                playerId: player.seeded.player.id,
                shipId: player.shipId,
                acceptedAt: new Date(),
              }
            : {}),
        },
      });
    }

    // Takes the parts out of the ship: the layout keeps the stale placements, like the other tests here.
    async function removeParts(
      player: AuthPair,
      matches: (part: {
        partClass: string;
        crg: number;
        min: number;
        specialProp: unknown;
      }) => boolean,
    ): Promise<void> {
      const installed = await prisma.partInstance.findMany({
        where: { shipId: player.shipId, ownerPlayerId: player.seeded.player.id },
        include: { partCatalog: true },
      });
      const ids = installed.filter((part) => matches(part.partCatalog)).map((part) => part.id);
      expect(ids.length).toBeGreaterThan(0);
      await prisma.partInstance.updateMany({
        where: { id: { in: ids } },
        data: { location: 'INVENTORY', shipId: null },
      });
    }

    // A mission that asks for more hold than the starter ship has: the ship itself stays able to fly
    // (taking the hold out of a random-connector kit can also disconnect other parts).
    async function askForBiggerHold(mission: MissionInstance): Promise<void> {
      await prisma.missionTemplate.update({
        where: { id: mission.templateId },
        data: { requirements: { cargo: 100000 } },
      });
    }

    function reasonCodes(body: unknown): string[] {
      const message = (body as { message: { reasons: Reason[] } }).message;
      return message.reasons.map((reason) => reason.code);
    }

    async function expectRefused(
      player: AuthPair,
      mission: MissionInstance,
      code: string,
    ): Promise<void> {
      const response = await dispatch(player.token, player.shipId, mission.id);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ message: { error: 'MISSION_REQUIREMENTS_NOT_MET' } });
      expect(reasonCodes(response.body)).toContain(code);
      const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
      expect(ship.status).toBe('IN_PORT');
    }

    it('refuses a RACE once the ship is below the race speed', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      const mission = await missionOfType(player, 'RACE');
      // a race that asks for more speed than the starter ship has (the ship stays able to fly)
      await prisma.missionTemplate.update({
        where: { id: mission.templateId },
        data: { requirements: { minMobility: 100000 } },
      });
      await expectRefused(player, mission, 'RACE_SPEED');
    });

    it('refuses a DELIVERY once the cargo space is gone', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      const mission = await missionOfType(player, 'DELIVERY');
      await askForBiggerHold(mission);
      await expectRefused(player, mission, 'CARGO_TYPE');
    });

    it('refuses a TRANSPORT once the life support is removed', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      const mission = await missionOfType(player, 'TRANSPORT');
      // the starter ship has no pressurized cabin with life support: it must not fly a transport
      await expectRefused(player, mission, 'PRESSURIZED_LIFE_SUPPORT');
    });

    it('refuses a TRANSPORT whose ship has a cabin and life support but too few seats, naming the seats', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      const mission = await missionOfType(player, 'TRANSPORT');
      // the ship carries a cabin (2 seats) and a life support (capacity 6), the group is 6
      const installed = await prisma.partInstance.findFirstOrThrow({
        where: { shipId: player.shipId, ownerPlayerId: player.seeded.player.id },
        include: { partCatalog: true },
      });
      await prisma.partCatalog.update({
        where: { partType: installed.partCatalog.partType },
        data: {
          specialProp: { pressurized: true, lifeSupport: true, pax: 2, lifeCap: 6 },
        },
      });
      await prisma.missionInstance.update({
        where: { id: mission.id },
        data: { cargo: { passengers: 6 } },
      });
      const response = await dispatch(player.token, player.shipId, mission.id);
      expect(response.status).toBe(400);
      const codes = reasonCodes(response.body);
      expect(codes).toContain('PASSENGER_SEATS');
      expect(codes).not.toContain('PRESSURIZED_LIFE_SUPPORT');
    });

    it('refuses a MINING mission once the drill is removed', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      const mission = await missionOfType(player, 'MINING');
      await expectRefused(player, mission, 'MINER');
    });

    it('still dispatches a TRAVEL mission (nothing to check)', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      const mission = await missionOfType(player, 'TRAVEL');
      const response = await dispatch(player.token, player.shipId, mission.id);
      expect(response.status).toBe(200);
    });

    it('still dispatches a SCAVENGE job even on a ship that fails every requirement', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      const mission = await missionOfType(player, 'SCAVENGE');
      await removeParts(player, (part) => part.crg > 0);
      const response = await dispatch(player.token, player.shipId, mission.id);
      expect(response.status).toBe(200);
    });

    it('accept and dispatch agree on the reasons for the same ship', async () => {
      await freshSeededApp();
      const player = await onboardPlayer();
      const available = await missionOfType(player, 'DELIVERY', 'AVAILABLE');
      await askForBiggerHold(available);
      const accepted = await request(httpServer(testApp.app))
        .post(`/v1/missions/${available.id}/accept`)
        .set(auth(player.token))
        .send({ shipId: player.shipId });
      expect(accepted.status).toBe(400);
      const mission = await missionOfType(player, 'DELIVERY');
      const response = await dispatch(player.token, player.shipId, mission.id);
      expect(response.status).toBe(400);
      const acceptBody = (accepted.body as { message: unknown }).message;
      const dispatchBody = (response.body as { message: unknown }).message;
      expect(dispatchBody).toEqual(acceptBody);
    });
  });
});
