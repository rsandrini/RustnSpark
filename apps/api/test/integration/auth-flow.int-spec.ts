import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { REFRESH_COOKIE_NAME } from '../../src/auth/auth.controller.js';
import { PasswordService } from '../../src/auth/password.service.js';
import { RefreshTokenService } from '../../src/auth/refresh-token.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import {
  accessTokenFrom,
  expectRefreshCookieAttributes,
  firstSetCookieFrom,
  refreshCookiePairFrom,
  seedAccountWithPlayer,
} from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

// Full auth flow against a real app boot and the real test Postgres (no mocks, R16-style).
// Register's 3/min per-IP throttle (R20) budgets this file to at most 2 HTTP registrations,
// so every other account here is seeded straight through Prisma (see auth-fixtures.ts).

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

describe('auth endpoints (S2.3)', () => {
  let testApp: TestApp;
  let prisma: PrismaService;
  let passwordService: PasswordService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwordService = testApp.app.get(PasswordService);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  it('runs the full register → login → me → locale → refresh → logout flow', async () => {
    const server = httpServer(testApp.app);

    // S3 C1: register returns 201 + a full session (access token + player + refresh cookie).
    const registerResponse = await request(server)
      .post('/v1/auth/register')
      .set('Accept-Language', 'pt-BR,pt;q=0.9')
      .send({ email: 'flow@example.com', password: 'flow-password-1', name: 'flow_pilot' });
    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body).toMatchObject({
      accessToken: expect.any(String),
      player: {
        id: expect.any(String),
        name: 'flow_pilot',
        credits: 0,
        locale: 'pt-BR',
        role: 'PLAYER',
      },
    });
    expectRefreshCookieAttributes(registerResponse);

    const loginResponse = await request(server)
      .post('/v1/auth/login')
      .send({ email: 'flow@example.com', password: 'flow-password-1' });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body).toMatchObject({
      accessToken: expect.any(String),
      player: (registerResponse.body as unknown as Record<string, unknown>).player,
    });
    expectRefreshCookieAttributes(loginResponse);
    const loginCookie = refreshCookiePairFrom(loginResponse);
    const accessToken = accessTokenFrom(loginResponse);

    const meResponse = await request(server)
      .get('/v1/players/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(meResponse.status).toBe(200);
    expect(meResponse.body).toEqual(
      (registerResponse.body as unknown as Record<string, unknown>).player,
    );

    const localeResponse = await request(server)
      .post('/v1/players/me/locale')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ locale: 'en' });
    expect(localeResponse.status).toBe(200);
    expect(localeResponse.body).toMatchObject({ locale: 'en' });

    const refreshResponse = await request(server)
      .post('/v1/auth/refresh')
      .set('Cookie', loginCookie);
    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body).toMatchObject({ accessToken: expect.any(String) });
    expectRefreshCookieAttributes(refreshResponse);
    const rotatedCookie = refreshCookiePairFrom(refreshResponse);
    expect(rotatedCookie).not.toBe(loginCookie);

    // R25: logout revokes only the presented token and clears the cookie.
    const logoutResponse = await request(server)
      .post('/v1/auth/logout')
      .set('Cookie', rotatedCookie);
    expect(logoutResponse.status).toBe(204);
    const clearCookie = firstSetCookieFrom(logoutResponse);
    expect(clearCookie).toContain('Max-Age=0');
    expect(clearCookie).toContain('Path=/v1/auth');
    expect(clearCookie).toContain('HttpOnly');
    expect(clearCookie).toContain('Secure');
    expect(clearCookie).toContain('SameSite=Strict');

    const replayResponse = await request(server)
      .post('/v1/auth/refresh')
      .set('Cookie', rotatedCookie);
    expect(replayResponse.status).toBe(401);
  });

  it('logs in regardless of email casing (R17)', async () => {
    const seeded = await seedAccountWithPlayer(prisma, passwordService, {
      email: 'casing@example.com',
    });

    const response = await request(httpServer(testApp.app))
      .post('/v1/auth/login')
      .send({ email: 'CaSing@EXAMPLE.com', password: seeded.password });

    expect(response.status).toBe(200);
  });

  it('stores a lowercased email on register (R17)', async () => {
    const response = await request(httpServer(testApp.app))
      .post('/v1/auth/register')
      .send({ email: 'MiXeD@Example.COM', password: 'mixed-password-1', name: 'mixed_pilot' });
    expect(response.status).toBe(201);

    const account = await prisma.account.findUnique({ where: { email: 'mixed@example.com' } });
    expect(account).not.toBeNull();
  });

  it('returns the identical generic 401 for a wrong password and an unknown email', async () => {
    const seeded = await seedAccountWithPlayer(prisma, passwordService);
    const server = httpServer(testApp.app);

    const wrongPassword = await request(server)
      .post('/v1/auth/login')
      .send({ email: seeded.email, password: 'wrong-password-1' });
    const unknownEmail = await request(server)
      .post('/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'wrong-password-1' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toMatchObject({
      statusCode: 401,
      message: 'invalid email or password',
    });
    expect(unknownEmail.body).toMatchObject({
      statusCode: 401,
      message: 'invalid email or password',
    });
  });

  it('rejects a banned account at login with the same generic 401 (R29)', async () => {
    const seeded = await seedAccountWithPlayer(prisma, passwordService, { status: 'BANNED' });

    const response = await request(httpServer(testApp.app))
      .post('/v1/auth/login')
      .send({ email: seeded.email, password: seeded.password });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ statusCode: 401, message: 'invalid email or password' });
  });

  it('rejects a banned account at refresh even with a valid cookie (R29)', async () => {
    const seeded = await seedAccountWithPlayer(prisma, passwordService, { status: 'BANNED' });
    const issued = await testApp.app.get(RefreshTokenService).issue(seeded.account.id);

    const response = await request(httpServer(testApp.app))
      .post('/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=${issued.token}`);

    expect(response.status).toBe(401);
  });

  it('revokes the whole family when a rotated refresh token is reused (R25)', async () => {
    const seeded = await seedAccountWithPlayer(prisma, passwordService);
    const server = httpServer(testApp.app);

    const login = await request(server)
      .post('/v1/auth/login')
      .send({ email: seeded.email, password: seeded.password });
    const firstCookie = refreshCookiePairFrom(login);

    const rotated = await request(server).post('/v1/auth/refresh').set('Cookie', firstCookie);
    expect(rotated.status).toBe(200);
    const rotatedCookie = refreshCookiePairFrom(rotated);

    // Replaying the rotated-out token is reuse: 401, and the whole family is revoked…
    const replay = await request(server).post('/v1/auth/refresh').set('Cookie', firstCookie);
    expect(replay.status).toBe(401);

    // …so even the legitimately rotated token is now dead.
    const after = await request(server).post('/v1/auth/refresh').set('Cookie', rotatedCookie);
    expect(after.status).toBe(401);
  });

  it('maps a missing, unknown or rotated-out refresh cookie to the same 401 shape (R25)', async () => {
    const server = httpServer(testApp.app);

    const missing = await request(server).post('/v1/auth/refresh');
    const unknown = await request(server)
      .post('/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=never-issued`);

    expect(missing.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(missing.body).toMatchObject({
      statusCode: 401,
      message: 'refresh token is missing or invalid',
    });
    expect(unknown.body).toMatchObject({
      statusCode: 401,
      message: 'refresh token is missing or invalid',
    });
  });

  it('logout is idempotent and revokes only the presented token, not the family (R25)', async () => {
    const server = httpServer(testApp.app);

    const noCookie = await request(server).post('/v1/auth/logout');
    expect(noCookie.status).toBe(204);

    const seeded = await seedAccountWithPlayer(prisma, passwordService);
    const loginA = await request(server)
      .post('/v1/auth/login')
      .send({ email: seeded.email, password: seeded.password });
    const loginB = await request(server)
      .post('/v1/auth/login')
      .send({ email: seeded.email, password: seeded.password });
    const cookieA = refreshCookiePairFrom(loginA);
    const cookieB = refreshCookiePairFrom(loginB);

    const logout = await request(server).post('/v1/auth/logout').set('Cookie', cookieA);
    expect(logout.status).toBe(204);

    // The presented token is dead…
    const refreshA = await request(server).post('/v1/auth/refresh').set('Cookie', cookieA);
    expect(refreshA.status).toBe(401);
    // …but the other session of the same account (a different family) is untouched.
    const refreshB = await request(server).post('/v1/auth/refresh').set('Cookie', cookieB);
    expect(refreshB.status).toBe(200);
  });
});
