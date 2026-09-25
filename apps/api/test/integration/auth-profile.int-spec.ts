import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { accessTokenFrom, expectRefreshCookieAttributes } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

// S3 C1: the admin UI profile contract exposes role (from Account) but never email.
describe('GET /v1/players/me profile shape', () => {
  let testApp: TestApp;
  let prisma: PrismaService;

  beforeAll(async () => {
    testApp = await createTestApp();
    prisma = testApp.app.get(PrismaService);
  });

  afterAll(async () => {
    await testApp?.close();
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  it('returns id, name, credits, locale, role and no email after register', async () => {
    const server = httpServer(testApp.app);

    const registerResponse = await request(server).post('/v1/auth/register').send({
      email: 'profile@example.com',
      password: 'profile-password-1',
      name: 'profile_pilot',
    });
    expect(registerResponse.status).toBe(201);
    expectRefreshCookieAttributes(registerResponse);

    const token = accessTokenFrom(registerResponse);

    const meResponse = await request(server)
      .get('/v1/players/me')
      .set('Authorization', `Bearer ${token}`);
    expect(meResponse.status).toBe(200);
    expect(meResponse.body).toEqual({
      id: expect.any(String),
      name: 'profile_pilot',
      credits: 0,
      locale: 'en',
      role: 'PLAYER',
      factionId: null,
    });
    expect((meResponse.body as Record<string, unknown>).email).toBeUndefined();
  });
});
