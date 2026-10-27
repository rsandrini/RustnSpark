import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { MyStatsResponseSchema, PublicProfileResponseSchema } from '@rustandspark/contract';
import request from 'supertest';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { PlayerStatsService } from '../../src/stats/player-stats.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { assembleStarterKit } from '../support/assemble.js';
import { seedAccountWithPlayer, type SeededPlayer } from '../support/auth-fixtures.js';
import { seed } from '../../prisma/seed.js';
import { resetDatabase } from '../support/test-db.js';

const httpServer = (app: INestApplication): Server => app.getHttpServer() as Server;

describe('pilot profile endpoints', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let tokenService: TokenService;
  let stats: PlayerStatsService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwordService = testApp.app.get(PasswordService);
    tokenService = testApp.app.get(TokenService);
    stats = testApp.app.get(PlayerStatsService);
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
    await seed(prisma);
  });
  afterAll(async () => {
    await testApp.close();
  });

  async function pilot(name: string): Promise<{ seeded: SeededPlayer; token: string }> {
    const seeded = await seedAccountWithPlayer(prisma, passwordService, { name });
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
    await assembleStarterKit(httpServer(testApp.app), token, (onboarded.body as { id: string }).id);
    return { seeded, token };
  }

  const get = (path: string, token: string) =>
    request(httpServer(testApp.app)).get(path).set('Authorization', `Bearer ${token}`);

  async function record(playerId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await stats.add(
        playerId,
        {
          'missions.started': 4,
          'missions.success': 3,
          'missions.failed': 1,
          'flight.distance': 900,
          'money.earned_missions': 5000,
          'damage.taken': 70,
        },
        tx,
      );
      await stats.best(playerId, 'best.race_place', 2, tx);
      await stats.best(playerId, 'best.payout', 1200, tx);
    });
  }

  it('shows another pilot only the public card, with a callsign, class and bridge rarity', async () => {
    const [alice, bob] = [await pilot('Alice'), await pilot('Bob')];
    await record(alice.seeded.player.id);

    const response = await get('/v1/players/by-name/Alice/profile', bob.token);
    expect(response.status).toBe(200);
    PublicProfileResponseSchema.parse(response.body);
    const body = response.body as {
      name: string;
      factionId: string;
      ship: { title: string; shipClass: string; bridgeRarity: string };
      totals: Record<string, number>;
      records: Record<string, { value: number }>;
      successRate: number;
    };
    expect(body.name).toBe('Alice');
    expect(body.factionId).toBe('luna');
    expect(body.totals).toEqual({
      'missions.started': 4,
      'missions.success': 3,
      'missions.failed': 1,
      'flight.distance': 900,
    });
    expect(Object.keys(body.records)).toEqual(['best.race_place']);
    expect(body.successRate).toBe(0.75);
    expect(body.ship.title).toMatch(/^LUN-Alice-[A-Za-z]+$/);
    expect(body.ship.shipClass).toBeTruthy();
    expect(body.ship.bridgeRarity).toBeTruthy();
    // nothing private, nothing about the ship's parts
    expect(JSON.stringify(body)).not.toMatch(/money|damage|payout|layout|parts/);
  });

  it('gives a pilot all their own numbers', async () => {
    const alice = await pilot('Alice');
    await record(alice.seeded.player.id);
    const response = await get('/v1/players/me/stats', alice.token);
    expect(response.status).toBe(200);
    MyStatsResponseSchema.parse(response.body);
    const body = response.body as {
      totals: Record<string, number>;
      records: Record<string, { value: number }>;
    };
    expect(body.totals['money.earned_missions']).toBe(5000);
    expect(body.records['best.payout']?.value).toBe(1200);
  });

  it('reads zeros for a pilot who has not flown, and a null success rate', async () => {
    const alice = await pilot('Alice');
    const bob = await pilot('Bob');
    const response = await get('/v1/players/by-name/Bob/profile', alice.token);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ totals: {}, records: {}, successRate: null });
    const mine = await get('/v1/players/me/stats', bob.token);
    expect(mine.body).toMatchObject({ totals: {}, records: {}, lastActiveAt: null });
  });

  it('answers 404 for an unknown or odd name, and 401 without a token', async () => {
    const alice = await pilot('Alice');
    for (const name of ['Nobody', 'a%20b', '%25', '%E2%9C%93', 'x'.repeat(300)]) {
      const response = await get(`/v1/players/by-name/${name}/profile`, alice.token);
      expect(response.status).toBe(404);
    }
    const anonymous = await request(httpServer(testApp.app)).get(
      '/v1/players/by-name/Alice/profile',
    );
    expect(anonymous.status).toBe(401);
    const anonymousMe = await request(httpServer(testApp.app)).get('/v1/players/me/stats');
    expect(anonymousMe.status).toBe(401);
  });

  it('finds a pilot whose name has a space or non-ASCII characters', async () => {
    const alice = await pilot('Alice');
    await pilot('Zoë Ünal');
    const response = await get(
      `/v1/players/by-name/${encodeURIComponent('Zoë Ünal')}/profile`,
      alice.token,
    );
    expect(response.status).toBe(200);
    expect((response.body as { name: string }).name).toBe('Zoë Ünal');
  });
});
