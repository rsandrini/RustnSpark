import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
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
import { JobsModule } from '../../src/jobs/jobs.module.js';
import {
  MISSION_QUEUE_NAME,
  RESOLVE_BACKOFF_BASE_MS,
  bullConnectionOptions,
} from '../../src/jobs/queues.js';
import { MissionProcessor } from '../../src/jobs/processors/mission.processor.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { PlayerEventService } from '../../src/players/player-event.service.js';
import { WalletService } from '../../src/players/wallet.service.js';
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

// S7.3 acceptance (plan line 439): ConfigService.snapshot() at resolution time with its
// rulesHash in the log (D33), conditional claim IN_TRANSIT → RESOLVING, one transaction
// writing log + ship damage/fuel/location + wallet credit/PlayerEvent + loot + final
// status, double invocation = single effect, retries with backoff and a dead-letter path
// (the failed set), and a non-IN_TRANSIT mission refused rather than resolved.
describe('mission resolve processor (S7.3)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let tokenService: TokenService;
  let configService: GameConfigService;
  let queue: Queue;
  let processor: MissionProcessor;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwordService = testApp.app.get(PasswordService);
    tokenService = testApp.app.get(TokenService);
    configService = testApp.app.get(GameConfigService);
    queue = testApp.app.get(getQueueToken(MISSION_QUEUE_NAME));
    // Constructed directly (like ping unit tests) so tests 1–4 don't boot a competing
    // BullMQ Worker; the real worker graph is proven by the retries test below.
    processor = new MissionProcessor(
      prisma,
      configService,
      testApp.app.get(WalletService),
      testApp.app.get(PlayerEventService),
    );
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seed(prisma);
    await configService.refresh();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
    await queue.obliterate({ force: true }).catch(() => undefined);
  });

  afterAll(async () => {
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
  // outcome (success/adrift) across runs instead of flipping with a random UUID.
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

  function fakeJob(missionId: string, data: DispatchJobData): Job<DispatchJobData> {
    return { id: missionId, name: 'resolve', data } as unknown as Job<DispatchJobData>;
  }

  async function dispatchedJob(
    player: AuthPair,
    mission: MissionInstance,
    fuel: number,
  ): Promise<Job<DispatchJobData>> {
    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel } });
    const response = await dispatch(player.token, player.shipId, mission.id);
    expect(response.status).toBe(200);
    const job = await queue.getJob(mission.id);
    expect(job).toBeTruthy();
    return job as Job<DispatchJobData>;
  }

  it('resolves an in-transit mission: resolution-time rulesHash, one-transaction effects, log, payout', async () => {
    const player = await authFor(testApp.app);
    // Distance ≥ ~150 keeps roundHalfEven(fuelUse × distance / 100) above zero, so the
    // run actually burns tank fuel (short legs round to a free transit).
    const mission = await createAcceptedMission(player, 's7.3-happy-seed', [150, 100]);
    const job = await dispatchedJob(player, mission, 10_000);

    // Producer-side defaultJobOptions (retries + backoff wired on the queue).
    expect(job.opts.attempts).toBe(3);
    expect(job.opts.backoff).toMatchObject({ type: 'exponential' });

    // D33: tune the rules while the mission is in flight; resolution must use the
    // new snapshot and record ITS hash, not the one from dispatch time.
    const hashAtDispatch = configService.snapshot().hash;
    await configService.setValue('economy.reward_per_tier', 999, 's7.3-test', 'D33 tuning');
    const hashAtResolution = configService.snapshot().hash;
    expect(hashAtResolution).not.toBe(hashAtDispatch);

    const playerRow = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
    });
    const shipBefore = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });

    const result = await processor.process(job);
    expect(result.skipped).toBe(false);
    expect(result.rulesHash).toBe(hashAtResolution);

    const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    expect(stored.status).toBe('DONE');

    const shipAfter = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    expect(shipAfter.status).toBe('IN_PORT');
    expect(shipAfter.currentLocationId).toBe('hedus');
    expect(shipAfter.fuel).toBeLessThan(shipBefore.fuel);

    const log = await prisma.missionLog.findUniqueOrThrow({ where: { missionId: mission.id } });
    expect(log.rulesHash).toBe(hashAtResolution);
    expect(log.seed).toBe(mission.seed);
    expect(log.outcome).toBe('success');
    expect(log.schemaVersion).toBe(1);
    const embed = log.shipSnapshot as {
      parts: { id: string; catalog: { partClass: string } }[];
      legs: unknown[];
    };
    expect(embed.parts.length).toBeGreaterThan(0);
    expect(typeof embed.parts[0]?.catalog.partClass).toBe('string');
    expect(embed.legs.length).toBe(2);
    const legJson = log.legs as { legs: { index: number }[]; events: { category: string }[] };
    expect(legJson.legs.map((leg) => leg.index)).toEqual([0, 1]);
    expect(legJson.events.some((event) => event.category === 'payment')).toBe(true);

    const creditsAfter = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
    });
    expect(creditsAfter.credits).toBeGreaterThan(playerRow.credits);
    const credited = creditsAfter.credits - playerRow.credits;
    const creditEvent = await prisma.playerEvent.findFirst({
      where: { playerId: player.seeded.player.id, type: 'wallet.credit', creditsDelta: credited },
    });
    expect(creditEvent).not.toBeNull();
    expect(String((creditEvent?.payload as { reason: string }).reason)).toContain(mission.id);
    const resolvedEvent = await prisma.playerEvent.findFirst({
      where: { playerId: player.seeded.player.id, type: 'mission.resolved' },
    });
    expect(resolvedEvent).not.toBeNull();
    expect((resolvedEvent?.payload as { missionId: string }).missionId).toBe(mission.id);
  }, 30_000);

  it('double invocation produces a single effect: payout credited once, one log row', async () => {
    const player = await authFor(testApp.app);
    const mission = await createAcceptedMission(player, 's7.3-double-seed', [150, 100]);
    const job = await dispatchedJob(player, mission, 10_000);

    const creditsAfterFirst0 = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
    });
    expect(creditsAfterFirst0.id).toBeTruthy();
    // Onboarding itself credits a starting balance, so count the delta around this process
    // call rather than the absolute number of wallet.credit events.
    const payoutsBefore = await prisma.playerEvent.count({
      where: { playerId: player.seeded.player.id, type: 'wallet.credit' },
    });

    const first = await processor.process(job);
    expect(first.skipped).toBe(false);
    const creditsAfterFirst = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
    });

    const second = await processor.process(job);
    expect(second.skipped).toBe(true);
    const creditsAfterSecond = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
    });
    expect(creditsAfterSecond.credits).toBe(creditsAfterFirst.credits);

    const logs = await prisma.missionLog.findMany({ where: { missionId: mission.id } });
    expect(logs).toHaveLength(1);
    const payouts = await prisma.playerEvent.count({
      where: { playerId: player.seeded.player.id, type: 'wallet.credit' },
    });
    expect(payouts).toBe(payoutsBefore + 1);
  }, 30_000);

  it('refuses a mission that is not IN_TRANSIT: claim fails, nothing is written', async () => {
    const player = await authFor(testApp.app);
    const mission = await createAcceptedMission(player, 's7.3-refuse-seed', [40]);
    const job = fakeJob(mission.id, {
      missionId: mission.id,
      arrivalAt: new Date().toISOString(),
      snapshot: {
        shipId: player.shipId,
        fuel: 0,
        currentLocationId: 'ceres',
        stance: 'NEUTRAL',
        parts: [],
        legs: [],
      },
    });

    await expect(processor.process(job)).rejects.toThrow(/not resolvable/i);

    const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    expect(stored.status).toBe('ACCEPTED');
    await expect(prisma.missionLog.findMany({ where: { missionId: mission.id } })).resolves.toEqual(
      [],
    );
  }, 30_000);

  it('adrift when fuel runs out: mission FAILED, ship ADRIFT, no payout', async () => {
    const player = await authFor(testApp.app);
    // 0.01 fuel against a multi-credit first-leg burn: the fuel gate trips → adrift.
    const mission = await createAcceptedMission(player, 's7.3-adrift-seed', [150, 100]);
    const creditsBefore = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
    });
    // Onboarding already emitted a wallet.credit; assert none arrive from THIS resolve.
    const payoutsBefore = await prisma.playerEvent.count({
      where: { playerId: player.seeded.player.id, type: 'wallet.credit' },
    });
    const job = await dispatchedJob(player, mission, 0.01);

    const result = await processor.process(job);
    expect(result.status).toBe('FAILED');

    const stored = await prisma.missionInstance.findUniqueOrThrow({ where: { id: mission.id } });
    expect(stored.status).toBe('FAILED');
    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    expect(ship.status).toBe('ADRIFT');
    expect(ship.currentLocationId).toBe('ceres');

    const log = await prisma.missionLog.findUniqueOrThrow({ where: { missionId: mission.id } });
    expect(log.outcome).toBe('adrift');

    const creditsAfter = await prisma.player.findUniqueOrThrow({
      where: { id: player.seeded.player.id },
    });
    expect(creditsAfter.credits).toBe(creditsBefore.credits);
    await expect(
      prisma.playerEvent.count({
        where: { playerId: player.seeded.player.id, type: 'wallet.credit' },
      }),
    ).resolves.toBe(payoutsBefore);
  }, 30_000);

  it('retries with backoff and dead-letters a poison job into the failed set', async () => {
    const connection = bullConnectionOptions(testApp.app.get(EnvService).get('REDIS_URL'));

    const producerQueue = new Queue(MISSION_QUEUE_NAME, { connection });
    const queueEvents = new QueueEvents(MISSION_QUEUE_NAME, { connection });
    let workerContext: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
    try {
      await queueEvents.waitUntilReady();
      const ghostId = randomUUID();
      const job = await producerQueue.add(
        'resolve',
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
        {
          jobId: ghostId,
          attempts: 3,
          backoff: { type: 'exponential', delay: RESOLVE_BACKOFF_BASE_MS },
        },
      );

      // The real worker graph (same module worker.ts boots) must compile with
      // MissionProcessor's DB/config/wallet dependencies and consume the queue.
      workerContext = await NestFactory.createApplicationContext(JobsModule, { logger: false });

      const deadline = Date.now() + 20_000;
      let state = await job.getState();
      while (state !== 'failed' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        state = await job.getState();
      }
      expect(state).toBe('failed');
      // The local Job handle's attemptsMade is stale after worker-side transitions;
      // re-fetch from Redis for the retry count.
      const reloaded = await producerQueue.getJob(ghostId);
      expect(reloaded).toBeTruthy();
      expect(reloaded?.attemptsMade).toBe(3);
    } finally {
      await workerContext?.close();
      await queueEvents.close();
      await producerQueue.close();
    }
  }, 30_000);
});
