import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { MissionInstance } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import request from 'supertest';
import { assembleStarterKit } from '../support/assemble.js';
import { seed } from '../../prisma/seed.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import type { DispatchJobData } from '../../src/missions/dispatch.service.js';
import { MISSION_QUEUE_NAME } from '../../src/jobs/queues.js';
import { MissionProcessor } from '../../src/jobs/processors/mission.processor.js';
import { MissionResolveService } from '../../src/missions/resolve.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

// RACE through the real pipeline: accept -> dispatch -> resolve. The rivals live in the mission's
// cargo, the entry minimum comes from the template (here lowered so the starter ship may enter),
// and the finishing place sets the prize.
describe('RACE mission resolution (pipeline)', () => {
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
    processor = new MissionProcessor(testApp.app.get(MissionResolveService));
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

  async function raceWith(rivalMobility: number): Promise<{
    mission: MissionInstance;
    token: string;
    shipId: string;
    playerId: string;
  }> {
    const seeded = await seedAccountWithPlayer(prisma, passwordService);
    const token = await tokenService.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const onboarded = await request(httpServer(testApp.app))
      .post('/v1/players/me/onboarding')
      .set('Authorization', `Bearer ${token}`)
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    const shipId = (onboarded.body as { id: string }).id;
    await assembleStarterKit(httpServer(testApp.app), token, shipId);

    // the starter ship (mobility 2) is below the default entry speed: the template lowers it
    await prisma.missionTemplate.update({
      where: { id: 'race_luna' },
      data: { requirements: { originFactions: ['luna'], minMobility: 1 } },
    });
    const route = await prisma.route.findFirstOrThrow({ orderBy: { id: 'asc' } });
    const mission = await prisma.missionInstance.create({
      data: {
        templateId: 'race_luna',
        type: 'RACE',
        factionId: 'luna',
        originId: 'ceres',
        destinationId: 'hedus',
        legs: [
          { routeId: route.id, distance: 150, danger: 0, zone: 0, env: { id: 'open', level: 1, fuelMult: 1 } },
        ],
        cargo: {
          race: {
            competitors: [1, 2, 3].map((n) => ({
              id: `rival-${n}`,
              name: `Rival ${n}`,
              mobility: rivalMobility,
            })),
          },
        },
        reward: 1600,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        seed: `race-${rivalMobility}`,
        status: 'ACCEPTED',
        playerId: seeded.player.id,
        shipId,
        acceptedAt: new Date(),
      },
    });
    return { mission, token, shipId, playerId: seeded.player.id };
  }

  async function run(setup: Awaited<ReturnType<typeof raceWith>>) {
    await prisma.ship.update({ where: { id: setup.shipId }, data: { fuel: 10_000 } });
    const response = await request(httpServer(testApp.app))
      .post(`/v1/ships/${setup.shipId}/dispatch`)
      .set('Authorization', `Bearer ${setup.token}`)
      .send({ missionId: setup.mission.id });
    expect(response.status).toBe(200);
    const job = (await queue.getJob(setup.mission.id)) as Job<DispatchJobData>;
    await processor.process(job);
    const credits = (await prisma.player.findUniqueOrThrow({ where: { id: setup.playerId } })).credits;
    const log = await prisma.missionLog.findUniqueOrThrow({ where: { missionId: setup.mission.id } });
    const events = (log.legs as { events: { type: string; race?: { place: number; standings: unknown[] } }[] })
      .events;
    return { credits, log, events };
  }

  it('beating every rival wins the top prize, paid once, with the standings in the log', async () => {
    const setup = await raceWith(0.5);
    const before = (await prisma.player.findUniqueOrThrow({ where: { id: setup.playerId } })).credits;
    const { credits, log, events } = await run(setup);
    const result = events.find((event) => event.type === 'race_result');
    expect(result?.race?.place).toBe(1);
    expect(result?.race?.standings).toHaveLength(4);
    expect(log.outcome).toBe('success');
    expect(credits).toBeGreaterThan(before);
    expect(events.filter((event) => event.type === 'mission_payout')).toHaveLength(1);
    // the report renders it (a template exists for the new event type)
    const report = await request(httpServer(testApp.app))
      .get(`/v1/reports/${setup.mission.id}`)
      .set('Authorization', `Bearer ${setup.token}`);
    expect(report.status).toBe(200);
  }, 30_000);

  it('being slower than the whole field finishes last and earns nothing', async () => {
    const setup = await raceWith(9);
    const before = (await prisma.player.findUniqueOrThrow({ where: { id: setup.playerId } })).credits;
    const { credits, log, events } = await run(setup);
    expect(events.find((event) => event.type === 'race_result')?.race?.place).toBe(4);
    expect(events.some((event) => event.type === 'mission_payout')).toBe(false);
    expect(log.outcome).toBe('partial_failure');
    expect(credits).toBe(before);
  }, 30_000);
});
