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

// Travel without a quest: a trip the pilot asks for is a mission of type TRAVEL created already
// accepted and dispatched, so it uses the same fuel, legs, lock and resolution as any mission,
// but has no cargo and pays nothing.
describe('travel without a quest', () => {
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

  const quote = (token: string, destinationId: string) =>
    request(httpServer(testApp.app))
      .get(`/v1/travel/quote?destinationId=${destinationId}`)
      .set(auth(token));
  const go = (token: string, destinationId: string) =>
    request(httpServer(testApp.app)).post('/v1/travel').set(auth(token)).send({ destinationId });

  interface QuoteBody {
    originId: string;
    destinationId: string;
    legs: Array<{ routeId: string; fromId: string; toId: string; distance: number }>;
    totalDistance: number;
    durationSeconds: number;
    fuelNeeded: number;
    fuelHave: number;
    blockers: string[];
    canDepart: boolean;
  }

  it('quotes a trip without creating anything, then flies it as a TRAVEL mission that pays nothing', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();

    const q = await quote(player.token, 'hedus');
    expect(q.status).toBe(200);
    const body = q.body as QuoteBody;
    expect(body).toMatchObject({ originId: 'ceres', destinationId: 'hedus', canDepart: true });
    expect(body.legs.length).toBeGreaterThan(0);
    expect(body.legs[0]!.fromId).toBe('ceres');
    expect(body.legs[body.legs.length - 1]!.toId).toBe('hedus');
    expect(body.totalDistance).toBeGreaterThan(0);
    expect(body.durationSeconds).toBeGreaterThan(0);
    expect(body.fuelNeeded).toBeGreaterThan(0);
    expect(body.fuelNeeded).toBeLessThanOrEqual(body.fuelHave);
    expect(await prisma.missionInstance.count({ where: { type: 'TRAVEL' } })).toBe(0);

    const flown = await go(player.token, 'hedus');
    expect(flown.status).toBe(200);
    expect(flown.body).toMatchObject({ missionId: expect.any(String) });

    const mission = await prisma.missionInstance.findFirstOrThrow({ where: { type: 'TRAVEL' } });
    expect(mission).toMatchObject({
      status: 'IN_TRANSIT',
      reward: 0,
      originId: 'ceres',
      destinationId: 'hedus',
      playerId: player.seeded.player.id,
      shipId: player.shipId,
    });
    expect(mission.cargo).toEqual({});
    const ship = await prisma.ship.findUniqueOrThrow({ where: { id: player.shipId } });
    expect(ship.status).toBe('ON_MISSION');
    expect(await queue.getJob(mission.id)).toBeTruthy();

    // One flight at a time: a second trip (or a double click) is refused with no second effect.
    const again = await go(player.token, 'hedus');
    expect(again.status).toBe(409);
    expect(await prisma.missionInstance.count({ where: { type: 'TRAVEL' } })).toBe(1);
    const active = await request(httpServer(testApp.app))
      .get('/v1/missions/active')
      .set(auth(player.token));
    expect(active.body).toMatchObject([{ id: mission.id, type: 'TRAVEL', status: 'IN_TRANSIT' }]);
  });

  it('refuses what cannot fly: same place, unknown place, not enough fuel', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();

    const same = await quote(player.token, 'ceres');
    expect((same.body as QuoteBody).blockers).toEqual(['SAME_PLACE']);
    expect((await go(player.token, 'ceres')).status).toBe(409);
    expect((await quote(player.token, 'nowhere')).status).toBe(404);

    await prisma.ship.update({ where: { id: player.shipId }, data: { fuel: 1 } });
    const dry = await quote(player.token, 'drift');
    const dryBody = dry.body as QuoteBody;
    if (dryBody.fuelNeeded > 1) {
      expect(dryBody.blockers).toContain('NOT_ENOUGH_FUEL');
      expect(dryBody.canDepart).toBe(false);
      const refused = await go(player.token, 'drift');
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ message: { error: 'NOT_ENOUGH_FUEL' } });
      expect(await prisma.missionInstance.count({ where: { type: 'TRAVEL' } })).toBe(0);
    }
  });

  it('never puts TRAVEL on a mission board', async () => {
    await freshSeededApp();
    const player = await onboardPlayer();
    for (const place of ['ceres', 'hedus', 'cair']) {
      await request(httpServer(testApp.app))
        .get(`/v1/locations/${place}/missions`)
        .set(auth(player.token));
    }
    expect(await prisma.missionInstance.count({ where: { type: 'TRAVEL' } })).toBe(0);
  });

  it('requires a token', async () => {
    await freshSeededApp();
    expect(
      (await request(httpServer(testApp.app)).get('/v1/travel/quote?destinationId=hedus')).status,
    ).toBe(401);
    expect(
      (await request(httpServer(testApp.app)).post('/v1/travel').send({ destinationId: 'hedus' }))
        .status,
    ).toBe(401);
  });
});
