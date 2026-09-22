import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PasswordService } from '../../src/auth/password.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { seedAccountWithPlayer } from '../support/auth-fixtures.js';
import { resetDatabase } from '../support/test-db.js';

// Route-level throttles (R20): login 5/min per IP+email, register 3/min per IP. This file has
// its own test app, so no other spec file's requests share these limiter buckets.

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

function expectRetryAfter(response: request.Response): void {
  expect(response.headers['retry-after']).toMatch(/^\d+$/);
  expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
}

describe('auth route throttles (R20)', () => {
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

  it('throttles login to 5/min per IP+email and returns Retry-After on 429', async () => {
    const seeded = await seedAccountWithPlayer(prisma, passwordService, {
      email: 'throttled@example.com',
    });
    const server = httpServer(testApp.app);

    for (let i = 0; i < 5; i += 1) {
      const attempt = await request(server)
        .post('/v1/auth/login')
        .send({ email: seeded.email, password: 'wrong-password-1' });
      expect(attempt.status).toBe(401);
    }

    const limited = await request(server)
      .post('/v1/auth/login')
      .send({ email: seeded.email, password: 'wrong-password-1' });
    expect(limited.status).toBe(429);
    expectRetryAfter(limited);
  });

  it('does not count a different email under the same IP toward the login bucket', async () => {
    const seeded = await seedAccountWithPlayer(prisma, passwordService, {
      email: 'bucketed@example.com',
    });
    const server = httpServer(testApp.app);

    for (let i = 0; i < 6; i += 1) {
      await request(server)
        .post('/v1/auth/login')
        .send({ email: seeded.email, password: 'wrong-password-1' });
    }

    // The same-IP bucket for another mailbox is untouched: 401 (bad credentials), not 429.
    const other = await request(server)
      .post('/v1/auth/login')
      .send({ email: 'someone-else@example.com', password: 'wrong-password-1' });
    expect(other.status).toBe(401);
  });

  it('throttles register to 3/min per IP and returns Retry-After on 429', async () => {
    const server = httpServer(testApp.app);

    for (let i = 0; i < 3; i += 1) {
      const created = await request(server)
        .post('/v1/auth/register')
        .send({
          email: `throttle-${randomUUID()}@example.com`,
          password: 'throttle-pass-1',
          name: `t-${randomUUID().replaceAll('-', '').slice(0, 20)}`,
        });
      expect(created.status).toBe(201);
    }

    const limited = await request(server)
      .post('/v1/auth/register')
      .send({
        email: `throttle-${randomUUID()}@example.com`,
        password: 'throttle-pass-1',
        name: `t-${randomUUID().replaceAll('-', '').slice(0, 20)}`,
      });
    expect(limited.status).toBe(429);
    expectRetryAfter(limited);
  });
});
