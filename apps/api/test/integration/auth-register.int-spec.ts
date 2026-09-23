import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { PasswordService } from '../../src/auth/password.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import {
  accessTokenFrom,
  expectRefreshCookieAttributes,
  seedAccountWithPlayer,
} from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

// Register behavior specs. Register is throttled at 3/min per IP (R20), so each test boots its
// own app for a fresh limiter (per-file would still share one bucket across these tests).

function stripRequestId(body: unknown): Record<string, unknown> {
  const copy = { ...(body as Record<string, unknown>) };
  delete copy.requestId;
  return copy;
}

describe('POST /v1/auth/register', () => {
  let testApp: TestApp | undefined;
  let prisma: PrismaService;
  let passwordService: PasswordService;

  beforeEach(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
    passwordService = testApp.app.get(PasswordService);
  });

  afterEach(async () => {
    await resetDatabase(prisma);
    await testApp?.close();
  });

  function server(): Server {
    if (!testApp) throw new Error('test app not initialized');
    return testApp.app.getHttpServer() as Server;
  }

  it('returns 201 with a session (access token + player profile + refresh cookie)', async () => {
    const response = await request(server()).post('/v1/auth/register').send({
      email: 'reg@example.com',
      password: 'reg-password-1',
      name: 'reg_pilot',
      locale: 'en',
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      accessToken: expect.any(String),
      player: {
        id: expect.any(String),
        name: 'reg_pilot',
        credits: 0,
        locale: 'en',
        role: 'PLAYER',
      },
    });
    expect(typeof accessTokenFrom(response)).toBe('string');
    expectRefreshCookieAttributes(response);

    const persisted = await prisma.player.findUnique({ where: { name: 'reg_pilot' } });
    expect(persisted).not.toBeNull();
  });

  it('rejects a duplicate email with a 409 that does not reveal the conflicting field', async () => {
    await seedAccountWithPlayer(prisma, passwordService, {
      email: 'taken@example.com',
      name: 'taken_name',
    });

    const response = await request(server())
      .post('/v1/auth/register')
      .send({ email: 'taken@example.com', password: 'other-password-1', name: 'fresh_name' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: 'email or player name is already in use',
    });
  });

  it('rejects a duplicate player name with a 409 that does not reveal the conflicting field', async () => {
    await seedAccountWithPlayer(prisma, passwordService, {
      email: 'taken@example.com',
      name: 'taken_name',
    });

    const response = await request(server())
      .post('/v1/auth/register')
      .send({ email: 'fresh@example.com', password: 'other-password-1', name: 'taken_name' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      statusCode: 409,
      message: 'email or player name is already in use',
    });
  });

  it('returns the identical 409 body whether the email or the name is the duplicate', async () => {
    await seedAccountWithPlayer(prisma, passwordService, {
      email: 'taken@example.com',
      name: 'taken_name',
    });

    const dupeEmail = await request(server())
      .post('/v1/auth/register')
      .send({ email: 'taken@example.com', password: 'other-password-1', name: 'another_name' });
    const dupeName = await request(server())
      .post('/v1/auth/register')
      .send({ email: 'fresh@example.com', password: 'other-password-1', name: 'taken_name' });

    expect(dupeEmail.status).toBe(409);
    expect(dupeName.status).toBe(409);
    // requestId legitimately differs per request; every other client-visible field is identical.
    expect(stripRequestId(dupeEmail.body)).toEqual(stripRequestId(dupeName.body));
  });

  it('takes the locale from Accept-Language when the body omits it', async () => {
    const response = await request(server())
      .post('/v1/auth/register')
      .set('Accept-Language', 'pt-BR,pt;q=0.9,en;q=0.8')
      .send({ email: 'hdr@example.com', password: 'hdr-password-1', name: 'hdr_pilot' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ player: { locale: 'pt-BR' } });
  });

  it("falls back to 'en' for an unsupported Accept-Language header", async () => {
    const response = await request(server())
      .post('/v1/auth/register')
      .set('Accept-Language', 'fr-FR,fr;q=0.8')
      .send({ email: 'fallback@example.com', password: 'fallback-pass-1', name: 'fallback_pilot' });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ player: { locale: 'en' } });
  });

  it('rejects an unsupported or wrongly-cased locale in the body with 400', async () => {
    const unsupported = await request(server()).post('/v1/auth/register').send({
      email: 'loc1@example.com',
      password: 'loc-password-1',
      name: 'loc_pilot_1',
      locale: 'fr',
    });
    const wrongCase = await request(server()).post('/v1/auth/register').send({
      email: 'loc2@example.com',
      password: 'loc-password-1',
      name: 'loc_pilot_2',
      locale: 'pt-br',
    });

    expect(unsupported.status).toBe(400);
    expect(wrongCase.status).toBe(400);
  });

  it('rejects a body carrying an unknown property with 400 (forbidNonWhitelisted)', async () => {
    const response = await request(server()).post('/v1/auth/register').send({
      email: 'extra@example.com',
      password: 'extra-password-1',
      name: 'extra_pilot',
      credits: 1_000_000,
    });

    expect(response.status).toBe(400);
  });

  it('rejects a malformed email with 400 via the global ValidationPipe', async () => {
    const response = await request(server())
      .post('/v1/auth/register')
      .send({ email: 'not-an-email', password: 'valid-password-1', name: 'valid_name' });

    expect(response.status).toBe(400);
  });
});
