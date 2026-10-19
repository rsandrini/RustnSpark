import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PasswordService } from '../../src/auth/password.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer, type SeededPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

describe('players/me endpoints (S2.3)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let tokenService: TokenService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwordService = testApp.app.get(PasswordService);
    tokenService = testApp.app.get(TokenService);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  async function seedAndToken(
    overrides: Parameters<typeof seedAccountWithPlayer>[2] = {},
  ): Promise<{ seeded: SeededPlayer; token: string }> {
    const seeded = await seedAccountWithPlayer(prisma, passwordService, overrides);
    const token = await tokenService.signAccessToken({
      accountId: seeded.account.id,
      playerId: seeded.player.id,
      role: 'PLAYER',
    });
    return { seeded, token };
  }

  it('returns the authenticated player profile', async () => {
    const { seeded, token } = await seedAndToken({ locale: 'pt-BR' });

    const response = await request(httpServer(testApp.app))
      .get('/v1/players/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: seeded.player.id,
      name: seeded.player.name,
      credits: 0,
      locale: 'pt-BR',
      role: seeded.account.role,
      factionId: null,
      tutorialDone: false,
    });
  });

  it('requires an access token', async () => {
    const response = await request(httpServer(testApp.app)).get('/v1/players/me');
    expect(response.status).toBe(401);
  });

  it('returns 404 when the token references a player that no longer exists', async () => {
    const token = await tokenService.signAccessToken({
      accountId: randomUUID(),
      playerId: randomUUID(),
      role: 'PLAYER',
    });

    const response = await request(httpServer(testApp.app))
      .get('/v1/players/me')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });

  it('updates the locale and persists it', async () => {
    const { seeded, token } = await seedAndToken();
    const server = httpServer(testApp.app);

    const updated = await request(server)
      .post('/v1/players/me/locale')
      .set('Authorization', `Bearer ${token}`)
      .send({ locale: 'pt-BR' });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ id: seeded.player.id, locale: 'pt-BR' });

    const persisted = await prisma.player.findUniqueOrThrow({ where: { id: seeded.player.id } });
    expect(persisted.locale).toBe('pt-BR');

    const me = await request(server).get('/v1/players/me').set('Authorization', `Bearer ${token}`);
    expect(me.body).toMatchObject({ locale: 'pt-BR' });
  });

  it('starts with the tutorial not done, saves skip / finish and reopening, and is idempotent', async () => {
    const { seeded, token } = await seedAndToken();
    const server = httpServer(testApp.app);
    const send = (done: unknown) =>
      request(server)
        .post('/v1/players/me/tutorial')
        .set('Authorization', `Bearer ${token}`)
        .send({ done });

    const me = await request(server).get('/v1/players/me').set('Authorization', `Bearer ${token}`);
    expect(me.body).toMatchObject({ tutorialDone: false });

    for (const done of [true, true, false]) {
      const response = await send(done);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: seeded.player.id, tutorialDone: done });
      const persisted = await prisma.player.findUniqueOrThrow({ where: { id: seeded.player.id } });
      expect(persisted.tutorialDone).toBe(done);
    }
    for (const bad of ['yes', 1, null, undefined]) {
      expect((await send(bad)).status).toBe(400);
    }
  });

  it("reports the checklist actions from the pilot's own records: refuelled, repaired, worked", async () => {
    const { seeded, token } = await seedAndToken();
    const server = httpServer(testApp.app);
    const progress = () =>
      request(server)
        .get('/v1/players/me/tutorial-progress')
        .set('Authorization', `Bearer ${token}`);

    expect((await progress()).body).toEqual({ refuelled: false, repaired: false, worked: false });

    await prisma.playerEvent.create({
      data: { playerId: seeded.player.id, type: 'refuel', creditsDelta: -5 },
    });
    expect((await progress()).body).toEqual({ refuelled: true, repaired: false, worked: false });

    await prisma.playerEvent.create({
      data: { playerId: seeded.player.id, type: 'repair.started', creditsDelta: -20 },
    });
    expect((await progress()).body).toEqual({ refuelled: true, repaired: true, worked: false });

    const unauthenticated = await request(server).get('/v1/players/me/tutorial-progress');
    expect(unauthenticated.status).toBe(401);
  });

  it('rejects a tutorial update without an access token', async () => {
    const response = await request(httpServer(testApp.app))
      .post('/v1/players/me/tutorial')
      .send({ done: true });
    expect(response.status).toBe(401);
  });

  it('rejects unsupported, wrongly-cased or missing locales with 400', async () => {
    const { token } = await seedAndToken();
    const server = httpServer(testApp.app);

    for (const body of [{ locale: 'fr' }, { locale: 'pt-br' }, {}]) {
      const response = await request(server)
        .post('/v1/players/me/locale')
        .set('Authorization', `Bearer ${token}`)
        .send(body);
      expect(response.status).toBe(400);
    }
  });

  it('rejects a locale update without an access token', async () => {
    const response = await request(httpServer(testApp.app))
      .post('/v1/players/me/locale')
      .send({ locale: 'en' });
    expect(response.status).toBe(401);
  });

  it('returns 404 on locale update when the token references a player that no longer exists', async () => {
    const token = await tokenService.signAccessToken({
      accountId: randomUUID(),
      playerId: randomUUID(),
      role: 'PLAYER',
    });

    const response = await request(httpServer(testApp.app))
      .post('/v1/players/me/locale')
      .set('Authorization', `Bearer ${token}`)
      .send({ locale: 'en' });

    expect(response.status).toBe(404);
  });
});
