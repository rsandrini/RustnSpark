import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { MissionInstance } from '@prisma/client';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import type { DispatchJobData } from '../../src/missions/dispatch.service.js';
import { MissionResolveService } from '../../src/missions/resolve.service.js';
import { MISSION_QUEUE_NAME } from '../../src/jobs/queues.js';
import { MissionProcessor } from '../../src/jobs/processors/mission.processor.js';
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

interface StoredEncounter {
  id: string;
  missionAId: string;
  missionBId: string;
  routeId: string;
  legIndex: number;
  seed: string;
  result: unknown;
}

interface LogEvent {
  type?: string;
  category?: string;
  actors?: { playerShipId?: string; opponentShipId?: string };
  effects?: { hp?: number; credits?: number };
}

// S7.5 acceptance (plan line 447 / D1): overlapping missions produce exactly one
// Encounter row and an event in both MissionLogs; the stored result is identical
// regardless of which mission resolves first; non-overlapping windows produce none;
// the defender need not be online (dispatch snapshot / frozen mid-flight rows);
// same-faction pairs are IGNORE per the policy tree; zones 0–1 produce no PvP.
describe('pvp overlap encounters (S7.5)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let tokenService: TokenService;
  let configService: GameConfigService;
  let missionQueue: Queue<DispatchJobData>;
  let resolveService: MissionResolveService;
  let processor: MissionProcessor;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwordService = testApp.app.get(PasswordService);
    tokenService = testApp.app.get(TokenService);
    configService = testApp.app.get(GameConfigService);
    missionQueue = testApp.app.get<Queue<DispatchJobData>>(getQueueToken(MISSION_QUEUE_NAME));
    resolveService = testApp.app.get(MissionResolveService);
    processor = new MissionProcessor(resolveService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seed(prisma);
    await configService.refresh();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
    await missionQueue.obliterate({ force: true }).catch(() => undefined);
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function authFor(faction: 'luna' | 'sun' | 'explorers'): Promise<AuthPair> {
    const seeded = await seedAccountWithPlayer(prisma, passwordService);
    const token = await tokenService.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const onboarded = await request(httpServer(testApp.app))
      .post('/v1/players/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ faction });
    expect(onboarded.status).toBe(200);
    await assembleStarterKit(httpServer(testApp.app), token, (onboarded.body as { id: string }).id);
    return { seeded, token, shipId: (onboarded.body as { id: string }).id };
  }

  const auth = (token: string): { Authorization: string } => ({
    Authorization: `Bearer ${token}`,
  });

  const HOME_LOCATIONS: Record<string, string> = {
    luna: 'ceres',
    sun: 'hedus',
    explorers: 'cair',
  };

  async function createAcceptedMission(
    player: AuthPair,
    seedValue: string,
    leg: { distance: number; zone: number },
    faction: 'luna' | 'sun' | 'explorers' = 'luna',
  ): Promise<MissionInstance> {
    const template = await prisma.missionTemplate.findFirstOrThrow({
      where: { type: 'DELIVERY' },
      orderBy: { id: 'asc' },
    });
    const route = await prisma.route.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const originId = HOME_LOCATIONS[faction] ?? 'ceres';
    const destinationId = originId === 'hedus' ? 'ceres' : 'hedus';
    return prisma.missionInstance.create({
      data: {
        templateId: template.id,
        type: 'DELIVERY',
        factionId: template.factionId,
        originId,
        destinationId,
        legs: [
          {
            routeId: route.id,
            distance: leg.distance,
            danger: 0,
            zone: leg.zone,
            env: { id: 'open', level: 1, fuelMult: 1 },
          },
        ],
        cargo: {},
        reward: 100,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        seed: seedValue,
        status: 'ACCEPTED',
        playerId: player.seeded.player.id,
        shipId: player.shipId,
        acceptedAt: new Date(),
      },
    });
  }

  async function dispatch(player: AuthPair, missionId: string): Promise<void> {
    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 10_000 } });
    const response = await request(httpServer(testApp.app))
      .post(`/v1/ships/${player.shipId}/dispatch`)
      .set(auth(player.token))
      .send({ missionId });
    expect(response.status).toBe(200);
  }

  async function resolveNow(missionId: string): Promise<void> {
    const mission = await prisma.missionInstance.findUniqueOrThrow({ where: { id: missionId } });
    const job = await missionQueue.getJob(missionId);
    if (!job) {
      throw new Error(`resolveNow: no queued job for ${missionId}`);
    }
    const result = await processor.process(job);
    expect(result.missionId).toBe(missionId);
    // Re-read to prove the row advanced past IN_TRANSIT.
    const after = await prisma.missionInstance.findUniqueOrThrow({ where: { id: missionId } });
    expect(after.status).not.toBe('IN_TRANSIT');
    expect(mission.id).toBe(missionId);
  }

  async function encountersFor(missionIdA: string, missionBId: string): Promise<StoredEncounter[]> {
    const [a, b] = missionIdA < missionBId ? [missionIdA, missionBId] : [missionBId, missionIdA];
    const rows = await prisma.encounter.findMany({
      where: { missionAId: a, missionBId: b },
    });
    return rows;
  }

  function eventsOf(log: { legs: unknown } | null): LogEvent[] {
    if (!log) return [];
    const legs = log.legs as { events?: LogEvent[] } | LogEvent[];
    if (Array.isArray(legs)) return legs;
    return legs.events ?? [];
  }

  function pvpEvents(events: LogEvent[]): LogEvent[] {
    return events.filter((event) => event.type === 'pvp_encounter');
  }

  async function seedOverlappingPair(options: {
    seedA: string;
    seedB: string;
    zone: number;
    factionA?: 'luna' | 'sun' | 'explorers';
    factionB?: 'luna' | 'sun' | 'explorers';
  }): Promise<{
    playerA: AuthPair;
    playerB: AuthPair;
    missionA: MissionInstance;
    missionB: MissionInstance;
  }> {
    const playerA = await authFor(options.factionA ?? 'luna');
    const playerB = await authFor(options.factionB ?? 'sun');
    const factionA = options.factionA ?? 'luna';
    const factionB = options.factionB ?? 'sun';
    const missionA = await createAcceptedMission(
      playerA,
      options.seedA,
      { distance: 200, zone: options.zone },
      factionA,
    );
    const missionB = await createAcceptedMission(
      playerB,
      options.seedB,
      { distance: 200, zone: options.zone },
      factionB,
    );
    await dispatch(playerA, missionA.id);
    await dispatch(playerB, missionB.id);
    return { playerA, playerB, missionA, missionB };
  }

  it('creates exactly one Encounter and an event in both logs for overlapping missions', async () => {
    const { missionA, missionB } = await seedOverlappingPair({
      seedA: 's7.5-overlap-a',
      seedB: 's7.5-overlap-b',
      zone: 2,
    });

    await resolveNow(missionA.id);
    await resolveNow(missionB.id);

    const rows = await encountersFor(missionA.id, missionB.id);
    expect(rows).toHaveLength(1);
    const encounter = rows[0]!;
    expect(encounter.missionAId).toBe(missionA.id < missionB.id ? missionA.id : missionB.id);
    expect(encounter.missionBId).toBe(missionA.id < missionB.id ? missionB.id : missionA.id);
    expect(typeof encounter.seed).toBe('string');
    expect(encounter.seed.length).toBeGreaterThan(0);

    const logA = await prisma.missionLog.findUnique({ where: { missionId: missionA.id } });
    const logB = await prisma.missionLog.findUnique({ where: { missionId: missionB.id } });
    expect(logA).not.toBeNull();
    expect(logB).not.toBeNull();
    expect(pvpEvents(eventsOf(logA))).toHaveLength(1);
    expect(pvpEvents(eventsOf(logB))).toHaveLength(1);
  }, 30_000);

  it('produces an identical Encounter.result regardless of resolve order (permutation)', async () => {
    const first = await seedOverlappingPair({
      seedA: 's7.5-perm-a',
      seedB: 's7.5-perm-b',
      zone: 2,
      factionA: 'luna',
      factionB: 'sun',
    });
    await resolveNow(first.missionA.id);
    await resolveNow(first.missionB.id);
    const rowsAFirst = await encountersFor(first.missionA.id, first.missionB.id);
    expect(rowsAFirst).toHaveLength(1);

    await resetDatabase(prisma);
    await seed(prisma);
    await configService.refresh();
    await missionQueue.obliterate({ force: true }).catch(() => undefined);

    const second = await seedOverlappingPair({
      seedA: 's7.5-perm-a',
      seedB: 's7.5-perm-b',
      zone: 2,
      factionA: 'luna',
      factionB: 'sun',
    });
    await resolveNow(second.missionB.id);
    await resolveNow(second.missionA.id);
    const rowsBFirst = await encountersFor(second.missionA.id, second.missionB.id);
    expect(rowsBFirst).toHaveLength(1);

    // Entity UUIDs differ across the mid-test reset; the permutation invariant is
    // that every policy-relevant field (and the pair seed) is identical.
    const stable = (row: StoredEncounter) => {
      const result = row.result as {
        zone: number;
        relation: string;
        decision: string;
        routeId: string;
        legIndex: number;
        usesDispatchSnapshot: boolean;
      };
      return {
        seed: row.seed,
        zone: result.zone,
        relation: result.relation,
        decision: result.decision,
        routeId: result.routeId,
        legIndex: result.legIndex,
        usesDispatchSnapshot: result.usesDispatchSnapshot,
      };
    };
    expect(stable(rowsBFirst[0]!)).toEqual(stable(rowsAFirst[0]!));
    expect(rowsBFirst[0]!.seed).toBe('s7.5-perm-a|s7.5-perm-b');
    expect(rowsAFirst[0]!.seed).toBe('s7.5-perm-a|s7.5-perm-b');
  }, 30_000);

  it('creates no Encounter when presence windows do not overlap', async () => {
    const playerA = await authFor('luna');
    const playerB = await authFor('sun');
    const missionA = await createAcceptedMission(
      playerA,
      's7.5-disjoint-a',
      { distance: 200, zone: 2 },
      'luna',
    );
    const missionB = await createAcceptedMission(
      playerB,
      's7.5-disjoint-b',
      { distance: 200, zone: 2 },
      'sun',
    );
    await dispatch(playerA, missionA.id);
    await dispatch(playerB, missionB.id);

    // Force B's window entirely after A's arrival so the GiST && predicate is false.
    const missionARow = await prisma.missionInstance.findUniqueOrThrow({
      where: { id: missionA.id },
    });
    const arrivalA = missionARow.arrivalAt;
    expect(arrivalA).not.toBeNull();
    await prisma.$executeRaw`
      UPDATE "RoutePresence"
      SET "window" = tstzrange(
        ${new Date(arrivalA!.getTime() + 60_000).toISOString()}::timestamptz,
        ${new Date(arrivalA!.getTime() + 3_600_000).toISOString()}::timestamptz
      )
      WHERE "missionId" = ${missionB.id}
    `;

    await resolveNow(missionA.id);
    await resolveNow(missionB.id);

    expect(await prisma.encounter.count()).toBe(0);
    const logA = await prisma.missionLog.findUnique({ where: { missionId: missionA.id } });
    const logB = await prisma.missionLog.findUnique({ where: { missionId: missionB.id } });
    expect(pvpEvents(eventsOf(logA))).toHaveLength(0);
    expect(pvpEvents(eventsOf(logB))).toHaveLength(0);
  }, 30_000);

  it('records the defender from the frozen dispatch snapshot without the defender resolving first', async () => {
    const { playerB, missionA, missionB } = await seedOverlappingPair({
      seedA: 's7.5-defender-a',
      seedB: 's7.5-defender-b',
      zone: 2,
      factionA: 'luna',
      factionB: 'explorers',
    });

    // Defender "offline": drop the delayed job so the encounter path must rebuild
    // the snapshot from frozen mid-flight rows, not from a live queue payload.
    const defenderJob = await missionQueue.getJob(missionB.id);
    await defenderJob?.remove();

    await resolveNow(missionA.id);

    const rows = await encountersFor(missionA.id, missionB.id);
    expect(rows).toHaveLength(1);
    const result = rows[0]!.result as {
      defenderShipId?: string;
      defenderPlayerId?: string;
      usesDispatchSnapshot?: boolean;
    };
    expect(result.defenderShipId ?? '').not.toBe('');
    expect(result.defenderShipId ?? playerB.shipId).toBeTruthy();

    // Defender mission is still in transit — it never resolved first.
    const defender = await prisma.missionInstance.findUniqueOrThrow({
      where: { id: missionB.id },
    });
    expect(defender.status).toBe('IN_TRANSIT');

    // Attacker's log already carries the encounter event from resolve-time.
    const logA = await prisma.missionLog.findUnique({ where: { missionId: missionA.id } });
    expect(pvpEvents(eventsOf(logA))).toHaveLength(1);
  }, 30_000);

  it('marks same-faction overlaps IGNORE per the policy tree', async () => {
    const { missionA, missionB } = await seedOverlappingPair({
      seedA: 's7.5-same-faction-a',
      seedB: 's7.5-same-faction-b',
      zone: 2,
      factionA: 'luna',
      factionB: 'luna',
    });

    await resolveNow(missionA.id);
    await resolveNow(missionB.id);

    const rows = await encountersFor(missionA.id, missionB.id);
    expect(rows).toHaveLength(1);
    const result = rows[0]!.result as { decision?: string; relation?: string };
    expect(result.decision).toBe('IGNORE');
    expect(result.relation).toBe('ALLY');

    const logA = await prisma.missionLog.findUnique({ where: { missionId: missionA.id } });
    const events = pvpEvents(eventsOf(logA));
    expect(events).toHaveLength(1);
    expect(events[0]?.effects?.hp ?? 0).toBe(0);
    expect(events[0]?.effects?.credits ?? 0).toBe(0);
  }, 30_000);

  it('creates no Encounter for overlapping windows in zones 0–1 (no PvP)', async () => {
    for (const zone of [0, 1]) {
      await resetDatabase(prisma);
      await seed(prisma);
      await configService.refresh();
      await missionQueue.obliterate({ force: true }).catch(() => undefined);

      const { missionA, missionB } = await seedOverlappingPair({
        seedA: `s7.5-zone${zone}-a`,
        seedB: `s7.5-zone${zone}-b`,
        zone,
      });

      await resolveNow(missionA.id);
      await resolveNow(missionB.id);

      expect(await prisma.encounter.count()).toBe(0);
      const logA = await prisma.missionLog.findUnique({ where: { missionId: missionA.id } });
      const logB = await prisma.missionLog.findUnique({ where: { missionId: missionB.id } });
      expect(pvpEvents(eventsOf(logA))).toHaveLength(0);
      expect(pvpEvents(eventsOf(logB))).toHaveLength(0);
    }
  }, 30_000);
});
