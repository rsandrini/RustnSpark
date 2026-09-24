import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { NestFactory } from '@nestjs/core';
import type { MissionInstance } from '@prisma/client';
import { Job, Queue, QueueEvents } from 'bullmq';
import request from 'supertest';
import { seed } from '../../prisma/seed.js';
import { EnvService } from '../../src/common/env/env.module.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import type { DispatchJobData } from '../../src/missions/dispatch.service.js';
import { MissionResolveService } from '../../src/missions/resolve.service.js';
import { JobsModule } from '../../src/jobs/jobs.module.js';
import { ReconcileProcessor } from '../../src/jobs/processors/reconcile.processor.js';
import {
  MISSION_QUEUE_NAME,
  RECONCILE_QUEUE_NAME,
  RESOLVE_JOB_NAME,
  bullConnectionOptions,
} from '../../src/jobs/queues.js';
import { PartsService } from '../../src/parts/parts.service.js';
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

// S7.4 acceptance (plan line 443): a repeatable job every RECONCILE_INTERVAL_MS; past-due
// IN_TRANSIT missions whose job is missing get resolved (lost-job / kill-worker / server-down
// at arrivalAt); a mission stuck in RESOLVING is returned to IN_TRANSIT (REQUEUE) and resolved;
// a dead-lettered job whose mission is gone is drained from the failed set; and
// "resolve on read" — GET /v1/missions/active synchronously resolves the player's due mission
// so the response never shows it still IN_TRANSIT past arrivalAt.
describe('reconciliation tick (S7.4)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let tokenService: TokenService;
  let configService: GameConfigService;
  let missionQueue: Queue<DispatchJobData>;
  let reconcileQueue: Queue;
  let processor: ReconcileProcessor;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwordService = testApp.app.get(PasswordService);
    tokenService = testApp.app.get(TokenService);
    configService = testApp.app.get(GameConfigService);
    missionQueue = testApp.app.get<Queue<DispatchJobData>>(getQueueToken(MISSION_QUEUE_NAME));
    // The reconcile queue only lives in the worker graph (JobsModule); the API app never
    // registers it, so the test opens its own bullmq Queue against the same Redis.
    reconcileQueue = new Queue(RECONCILE_QUEUE_NAME, {
      connection: bullConnectionOptions(testApp.app.get(EnvService).get('REDIS_URL')),
    });
    // Constructed directly so tests 1–4 don't boot a competing BullMQ Worker; the real
    // worker graph is proven by the scheduler-upsert test below.
    processor = new ReconcileProcessor(
      prisma,
      missionQueue,
      testApp.app.get(MissionResolveService),
      testApp.app.get(PartsService),
    );
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seed(prisma);
    await configService.refresh();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
    await missionQueue.obliterate({ force: true }).catch(() => undefined);
    const schedulers = await reconcileQueue.getJobSchedulers().catch(() => []);
    for (const scheduler of schedulers) {
      await reconcileQueue.removeJobScheduler(scheduler.key).catch(() => undefined);
    }
    await reconcileQueue.obliterate({ force: true }).catch(() => undefined);
  });

  afterAll(async () => {
    await reconcileQueue.close();
    await testApp.close();
  });

  async function authFor(app: INestApplication): Promise<AuthPair> {
    const seeded = await seedAccountWithPlayer(prisma, passwordService);
    const token = await tokenService.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const onboarded = await request(httpServer(app))
      .post('/v1/players/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    return { seeded, token, shipId: (onboarded.body as { id: string }).id };
  }

  const auth = (token: string): { Authorization: string } => ({
    Authorization: `Bearer ${token}`,
  });

  // Fixed seed per test: the resolver is deterministic, so a stable seed pins the
  // outcome across runs instead of flipping with a random UUID.
  async function createAcceptedMission(
    player: AuthPair,
    seedValue: string,
    legDistances: readonly number[],
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
        originId: 'ceres',
        destinationId: 'hedus',
        legs: legDistances.map((distance) => ({
          routeId: route.id,
          distance,
          danger: 0,
          zone: 0,
          env: { id: 'open', level: 1, fuelMult: 1 },
        })),
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

  function dispatch(token: string, shipId: string, missionId: string) {
    return request(httpServer(testApp.app))
      .post(`/v1/ships/${shipId}/dispatch`)
      .set(auth(token))
      .send({ missionId });
  }

  async function dispatchedAndDue(
    player: AuthPair,
    mission: MissionInstance,
  ): Promise<MissionInstance> {
    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 10_000 } });
    const response = await dispatch(player.token, player.shipId, mission.id);
    expect(response.status).toBe(200);
    // Lost-job scenario: the delayed resolve job is gone (kill-worker / Redis blip /
    // enqueue failure), and arrivalAt is already in the past.
    const job = await missionQueue.getJob(mission.id);
    await job?.remove();
    return prisma.missionInstance.update({
      where: { id: mission.id },
      data: { arrivalAt: new Date(Date.now() - 1000) },
    });
  }

  const tick = { id: 'tick-1', name: 'tick', data: {} } as unknown as Job<Record<string, never>>;

  async function expectResolved(missionId: string): Promise<void> {
    const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: missionId } });
    expect(stored.status).toBe('DONE');
    const log = await prisma.missionLog.findUnique({ where: { missionId } });
    expect(log).not.toBeNull();
  }

  it('resolves a past-due IN_TRANSIT mission whose job is missing (lost job / server down)', async () => {
    const player = await authFor(testApp.app);
    const mission = await createAcceptedMission(player, 's7.4-lost-seed', [150, 100]);
    await dispatchedAndDue(player, mission);

    const result = await processor.process(tick);
    expect(result.resolved).toBeGreaterThanOrEqual(1);

    await expectResolved(mission.id);
    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    expect(ship.status).toBe('IN_PORT');
    expect(ship.currentLocationId).toBe('hedus');
  }, 30_000);

  it('returns a mission stuck in RESOLVING to IN_TRANSIT (REQUEUE) and resolves it', async () => {
    const player = await authFor(testApp.app);
    const mission = await createAcceptedMission(player, 's7.4-stuck-seed', [150, 100]);
    const due = await dispatchedAndDue(player, mission);
    // Crash after the claim: status is RESOLVING and the job is gone.
    expect(due.status).toBe('IN_TRANSIT');
    await prisma.missionInstance.update({
      where: { id: mission.id },
      data: { status: 'RESOLVING' },
    });

    const result = await processor.process(tick);
    expect(result.resolved).toBeGreaterThanOrEqual(1);

    await expectResolved(mission.id);
  }, 30_000);

  it('drains a dead-lettered job whose mission row is gone (ghost failed job)', async () => {
    const ghostId = randomUUID();
    const connection = bullConnectionOptions(testApp.app.get(EnvService).get('REDIS_URL'));
    const producerQueue = new Queue(MISSION_QUEUE_NAME, { connection });
    const queueEvents = new QueueEvents(MISSION_QUEUE_NAME, { connection });
    let workerContext: INestApplicationContext | undefined;
    try {
      await queueEvents.waitUntilReady();
      const job = await producerQueue.add(
        RESOLVE_JOB_NAME,
        {
          missionId: ghostId,
          arrivalAt: new Date().toISOString(),
          snapshot: {
            shipId: randomUUID(),
            fuel: 0,
            currentLocationId: 'ceres',
            stance: 'NEUTRAL',
            parts: [],
            legs: [],
          },
        } satisfies DispatchJobData,
        { jobId: ghostId, attempts: 1 },
      );

      // Real worker drives the poison job into the failed set (the dead-letter path).
      workerContext = await NestFactory.createApplicationContext(JobsModule, { logger: false });
      const deadline = Date.now() + 15_000;
      let state = await job.getState();
      while (state !== 'failed' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        state = await job.getState();
      }
      expect(state).toBe('failed');
    } finally {
      await workerContext?.close();
      await queueEvents.close();
      await producerQueue.close();
    }

    expect(await missionQueue.getJob(ghostId)).toBeTruthy();

    const result = await processor.process(tick);
    expect(result.drained).toBeGreaterThanOrEqual(1);

    expect(await missionQueue.getJob(ghostId)).toBeFalsy();
    const failed = await missionQueue.getFailed();
    expect(failed.find((entry) => entry.id === ghostId)).toBeUndefined();
  }, 30_000);

  it('resolve on read: GET /v1/missions/active resolves the player’s due mission synchronously', async () => {
    const player = await authFor(testApp.app);
    const mission = await createAcceptedMission(player, 's7.4-read-seed', [150, 100]);
    await dispatchedAndDue(player, mission);

    // No reconciler tick — the HTTP read itself must resolve before answering.
    const response = await request(httpServer(testApp.app))
      .get('/v1/missions/active')
      .set(auth(player.token));
    expect(response.status).toBe(200);
    const rows = response.body as Array<{ id: string; status: string }>;
    const shown = rows.find((row) => row.id === mission.id);
    // DONE is not player-visible, so a resolved mission is absent rather than IN_TRANSIT.
    expect(shown?.status).not.toBe('IN_TRANSIT');

    await expectResolved(mission.id);
  }, 30_000);

  it('upserts a repeatable reconcile job every RECONCILE_INTERVAL_MS on worker boot', async () => {
    const previous = process.env['RECONCILE_INTERVAL_MS'];
    process.env['RECONCILE_INTERVAL_MS'] = '12345';
    let workerContext: INestApplicationContext | undefined;
    try {
      workerContext = await NestFactory.createApplicationContext(JobsModule, { logger: false });
      const queue = workerContext.get<Queue>(getQueueToken(RECONCILE_QUEUE_NAME));
      const schedulers = await queue.getJobSchedulers();
      expect(schedulers.length).toBeGreaterThanOrEqual(1);
      const scheduler = schedulers.find((entry) => entry.every === 12345);
      expect(scheduler).toBeTruthy();
      expect(scheduler?.name).toBe('tick');
    } finally {
      await workerContext?.close();
      if (previous === undefined) {
        delete process.env['RECONCILE_INTERVAL_MS'];
      } else {
        process.env['RECONCILE_INTERVAL_MS'] = previous;
      }
    }
  }, 30_000);
});
