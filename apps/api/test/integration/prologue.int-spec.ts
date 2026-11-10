import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { GAME_CONFIG_DEFAULTS } from '../../src/config/game-config.defaults.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { seed } from '../../prisma/seed.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

const START = GAME_CONFIG_DEFAULTS.economy.start_credits;

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

describe('the new-pilot opening: payouts and a saved outcome', () => {
  let testApp: TestApp;
  let prisma: PrismaService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seed(prisma);
    await testApp.app.get(GameConfigService).refresh();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  async function pilot(): Promise<{ playerId: string; auth: { Authorization: string } }> {
    const seeded = await seedAccountWithPlayer(prisma, testApp.app.get(PasswordService));
    const token = await testApp.app.get(TokenService).signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    return { playerId: seeded.player.id, auth: { Authorization: `Bearer ${token}` } };
  }

  const server = () => httpServer(testApp.app);

  it('GET returns payouts that cover the refuel and leave exactly economy.start_credits', async () => {
    const { auth } = await pilot();
    const response = await request(server()).get('/v1/players/me/prologue').set(auth);
    expect(response.status).toBe(200);
    const body = response.body as { startCredits: number; refuelCost: number; payouts: number[] };
    expect(body.startCredits).toBe(START);
    expect(body.payouts).toHaveLength(3);
    expect(body.refuelCost).toBe(GAME_CONFIG_DEFAULTS.onboarding.prologue_refuel_cost);
    expect(body.payouts.reduce((sum, payout) => sum + payout, 0) - body.refuelCost).toBe(START);
  });

  it('requires an access token', async () => {
    expect((await request(server()).get('/v1/players/me/prologue')).status).toBe(401);
    expect(
      (await request(server()).post('/v1/players/me/prologue').send({ outcome: 'played' })).status,
    ).toBe(401);
  });

  it('POST played saves the outcome and the profile shows it', async () => {
    const { playerId, auth } = await pilot();
    const before = await request(server()).get('/v1/players/me').set(auth);
    expect((before.body as { prologueOutcome: string | null }).prologueOutcome).toBeNull();

    const saved = await request(server())
      .post('/v1/players/me/prologue')
      .set(auth)
      .send({ outcome: 'played' });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ outcome: 'played' });

    const after = await request(server()).get('/v1/players/me').set(auth);
    expect((after.body as { prologueOutcome: string }).prologueOutcome).toBe('played');
    const events = await prisma.playerEvent.findMany({
      where: { playerId, type: 'onboarding.prologue' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({ outcome: 'played' });
  });

  it('a second POST with another value does not change it', async () => {
    const { playerId, auth } = await pilot();
    await request(server()).post('/v1/players/me/prologue').set(auth).send({ outcome: 'skipped' });
    const second = await request(server())
      .post('/v1/players/me/prologue')
      .set(auth)
      .send({ outcome: 'played' });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ outcome: 'skipped' });
    expect(
      await prisma.playerEvent.count({ where: { playerId, type: 'onboarding.prologue' } }),
    ).toBe(1);
  });

  it('rejects an outcome that is neither played nor skipped', async () => {
    const { auth } = await pilot();
    const response = await request(server())
      .post('/v1/players/me/prologue')
      .set(auth)
      .send({ outcome: 'won' });
    expect(response.status).toBe(400);
  });

  it.each(['played', 'skipped'] as const)(
    'a pilot who %s the opening ends onboarding with economy.start_credits',
    async (outcome) => {
      const { playerId, auth } = await pilot();
      await request(server()).post('/v1/players/me/prologue').set(auth).send({ outcome });
      const onboarded = await request(server())
        .post('/v1/players/me/onboarding')
        .set(auth)
        .send({ faction: 'luna' });
      expect(onboarded.status).toBe(200);
      const player = await prisma.player.findUniqueOrThrow({ where: { id: playerId } });
      expect(player.credits).toBe(START);
      expect(player.prologueOutcome).toBe(outcome);
    },
  );
});
