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
import { MISSION_QUEUE_NAME } from '../../src/jobs/queues.js';
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

// Round-10 owner request: "add independent mining missions at minable locations (fixed
// duration, stops early if ship cargo full)" — same shape as the scavenging job (W8): a free
// MINING mission that starts and ends at the ship's own location, through the same
// DispatchService, gated on the location actually being minable and the ship carrying a
// mining rig (neither of which the board flow has to check, since a contracted board offer
// is only ever shown where it was already generated to be eligible).
describe('independent mining job (round 10)', () => {
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

  afterEach(async () => {
    await resetDatabase(prisma);
    await queue.obliterate({ force: true }).catch(() => undefined);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  async function freshSeededApp(): Promise<void> {
    await resetDatabase(prisma);
    await seed(prisma);
    await configService.refresh();
  }

  const auth = (token: string): { Authorization: string } => ({ Authorization: `Bearer ${token}` });

  async function onboardPlayer(): Promise<AuthPair> {
    const seeded = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    const token = await testApp.app.get(TokenService).signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    const onboarded = await request(httpServer(testApp.app))
      .post('/v1/players/me/onboarding')
      .set(auth(token))
      .send({ faction: 'luna' });
    expect(onboarded.status).toBe(200);
    const shipId = (onboarded.body as { id: string }).id;
    await assembleStarterKit(httpServer(testApp.app), token, shipId);
    return { seeded, token, shipId };
  }

  // The starter kit's power budget has no margin at all — a rig alone tips continuous energy
  // negative (SHIP_NOT_VIABLE), so the test rig always comes with its own reactor.
  async function installMiningRig(playerId: string, shipId: string): Promise<void> {
    await prisma.partInstance.createMany({
      data: [
        { partType: 'mining_rig', ownerPlayerId: playerId, condition: 100, location: 'INSTALLED', shipId },
        { partType: 'reactor_solar', ownerPlayerId: playerId, condition: 100, location: 'INSTALLED', shipId },
      ],
    });
  }

  const start = (token: string, locationId: string) =>
    request(httpServer(testApp.app)).post(`/v1/locations/${locationId}/mine`).set(auth(token));

  // Every seeded faction has at least one MINING template, and the owning faction's own
  // locations are always eligible for its own template (luna's has no originTypes
  // restriction at all) — so NOT_MINABLE is exercised at the predicate level
  // (template.filler.spec.ts's isMiningEligible tests), not against this particular seed.

  it('refuses without a mining rig installed (NO_MINING_RIG)', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();

    const response = await start(player.token, 'ceres');
    expect(response.status).toBe(400);
    expect((response.body as { message?: { error?: string } }).message?.error).toBe(
      'NO_MINING_RIG',
    );
  });

  it('starts a job at a minable location with a mining rig: free MINING mission, ship locked, no reward', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    await installMiningRig(player.seeded.player.id, player.shipId);

    const response = await start(player.token, 'ceres');
    expect(response.status).toBe(200);
    const body = response.body as { missionId: string; durationSeconds?: number };
    expect(
      Math.abs(
        (body.durationSeconds ?? 0) - configService.snapshot().rules.mining.job_duration_seconds,
      ),
    ).toBeLessThanOrEqual(5);

    const mission = await prisma.missionInstance.findUniqueOrThrow({
      where: { id: body.missionId },
    });
    expect(mission).toMatchObject({
      type: 'MINING',
      status: 'IN_TRANSIT',
      originId: 'ceres',
      destinationId: 'ceres',
      reward: 0,
    });
    expect((mission.cargo as { contracted?: boolean }).contracted).toBe(false);
    expect(typeof (mission.cargo as { materialId?: string }).materialId).toBe('string');

    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    expect(ship.status).toBe('ON_MISSION');
    expect(await queue.getJob(mission.id)).toBeTruthy();

    // One flight at a time.
    expect((await start(player.token, 'ceres')).status).toBe(409);
  });
});
