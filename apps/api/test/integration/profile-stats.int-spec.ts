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

  // The card is addressed by the pilot's random public id, never by name.
  const cardOf = async (pilotName: string, token: string) => {
    const row = await prisma.player.findUniqueOrThrow({ where: { name: pilotName } });
    return get(`/v1/players/profile/${row.publicId}`, token);
  };

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

    const response = await cardOf('Alice', bob.token);
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
    // The card shows the ship's own name, the same callsign the pilot sees on their ship.
    const own = await get('/v1/ships', alice.token);
    expect((own.body as { name: string }[])[0]?.name).toBe(body.ship.title);
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
    const response = await cardOf('Bob', alice.token);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ totals: {}, records: {}, successRate: null });
    const mine = await get('/v1/players/me/stats', bob.token);
    expect(mine.body).toMatchObject({ totals: {}, records: {}, lastActiveAt: null });
  });

  it('serves no account data on the card, and 404 once the account is banned', async () => {
    const alice = await pilot('Alice');
    const bob = await pilot('Bob');
    const card = await cardOf('Bob', alice.token);
    expect(card.status).toBe(200);
    expect(Object.keys(card.body as object).sort()).toEqual(
      ['factionId', 'name', 'publicId', 'records', 'ship', 'successRate', 'totals'].sort(),
    );
    expect(JSON.stringify(card.body)).not.toContain(bob.seeded.account.email);

    await prisma.account.update({
      where: { id: bob.seeded.account.id },
      data: { status: 'BANNED' },
    });
    const hidden = await cardOf('Bob', alice.token);
    expect(hidden.status).toBe(404);
  });

  it('answers 404 for an unknown or odd id, 401 without a token, and no longer serves a card by name', async () => {
    const alice = await pilot('Alice');
    for (const id of ['nobody000000', 'a%20b', '%25', '%E2%9C%93', 'x'.repeat(300)]) {
      const response = await get(`/v1/players/profile/${id}`, alice.token);
      expect(response.status).toBe(404);
    }
    // the pilot's name is not an address
    expect((await get('/v1/players/profile/Alice', alice.token)).status).toBe(404);
    expect((await get('/v1/players/by-name/Alice/profile', alice.token)).status).toBe(404);
    const row = await prisma.player.findUniqueOrThrow({ where: { name: 'Alice' } });
    const anonymous = await request(httpServer(testApp.app)).get(
      `/v1/players/profile/${row.publicId}`,
    );
    expect(anonymous.status).toBe(401);
    const anonymousMe = await request(httpServer(testApp.app)).get('/v1/players/me/stats');
    expect(anonymousMe.status).toBe(401);
  });

  it('gives each pilot a random public id that does not spell the name or the player id', async () => {
    await pilot('Alice');
    await pilot('Bob');
    const rows = await prisma.player.findMany();
    expect(new Set(rows.map((row) => row.publicId)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.publicId).toMatch(/^[0-9a-f]{12}$/);
      expect(row.publicId).not.toBe(row.id.slice(0, 12));
    }
  });

  it('finds a pilot whose name has a space or non-ASCII characters', async () => {
    const alice = await pilot('Alice');
    await pilot('Zoë Ünal');
    const response = await cardOf('Zoë Ünal', alice.token);
    expect(response.status).toBe(200);
    expect((response.body as { name: string }).name).toBe('Zoë Ünal');
  });
});
