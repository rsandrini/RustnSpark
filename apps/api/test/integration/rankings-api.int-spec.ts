import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { RaceRoutesResponseSchema, RankingResponseSchema } from '@rustandspark/contract';
import request from 'supertest';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

const httpServer = (app: INestApplication): Server => app.getHttpServer() as Server;

describe('rankings endpoints', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let token: string;
  let playerId: string;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    const seeded = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService), {
      name: 'Ann',
    });
    playerId = seeded.player.id;
    token = await testApp.app.get(TokenService).signAccessToken({
      accountId: seeded.account.id,
      playerId,
      role: 'PLAYER',
    });
  });
  afterAll(async () => {
    await testApp.close();
  });

  const get = (path: string) =>
    request(httpServer(testApp.app)).get(path).set('Authorization', `Bearer ${token}`);

  it('serves each board in the contract shape, with the own row', async () => {
    await prisma.playerStats.create({
      data: { playerId, totals: { 'flight.distance': 12, 'fights.won': 2, 'races.won': 1 } },
    });
    await prisma.raceResult.create({
      data: {
        playerId,
        missionId: randomUUID(),
        routeKey: 'ceres>hedus',
        originId: 'ceres',
        destinationId: 'hedus',
        seconds: 99,
        place: 1,
        day: new Date('2026-10-28'),
      },
    });
    await prisma.shipRating.create({
      data: { playerId, shipId: randomUUID(), power: 90, speed: 1.2, firepower: 5, armor: 2 },
    });
    for (const path of [
      '/v1/rankings/ship_power',
      '/v1/rankings/ship_speed?window=weekly',
      '/v1/rankings/distance',
      '/v1/rankings/fights_won?window=lifetime',
      '/v1/rankings/race_wins?window=weekly',
      '/v1/rankings/race_time?route=ceres%3Ehedus',
    ]) {
      const response = await get(path);
      expect(response.status).toBe(200);
      RankingResponseSchema.parse(response.body);
    }
    const distance = (await get('/v1/rankings/distance')).body as {
      entries: { name: string; isMe: boolean }[];
      me: { rank: number };
    };
    expect(distance.entries).toMatchObject([{ name: 'Ann', isMe: true }]);
    expect(distance.me.rank).toBe(1);
  });

  it('lists the race routes before treating the path as a board', async () => {
    const response = await get('/v1/rankings/race-routes');
    expect(response.status).toBe(200);
    expect(RaceRoutesResponseSchema.parse(response.body)).toEqual({ routes: [] });
  });

  it('answers 400 with a code for a bad board, a bad window and a missing route', async () => {
    expect((await get('/v1/rankings/money')).body).toMatchObject({
      message: { error: 'INVALID_BOARD' },
    });
    expect((await get('/v1/rankings/distance?window=daily')).body).toMatchObject({
      message: { error: 'INVALID_WINDOW' },
    });
    const missing = await get('/v1/rankings/race_time');
    expect(missing.status).toBe(400);
    expect(missing.body).toMatchObject({ message: { error: 'ROUTE_REQUIRED' } });
  });

  it('needs a signed-in pilot', async () => {
    expect((await request(httpServer(testApp.app)).get('/v1/rankings/distance')).status).toBe(401);
    expect((await request(httpServer(testApp.app)).get('/v1/rankings/race-routes')).status).toBe(
      401,
    );
  });
});
