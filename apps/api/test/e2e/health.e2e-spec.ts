import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, type TestApp } from '../support/app-factory.js';

// Targets the compose `test` profile's tmpfs Postgres/Redis (D9): run
// `docker compose --profile test up -d --wait postgres-test redis-test` before `pnpm test:e2e`.

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

describe('GET /v1/health against the real compose stack', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('reports both database and redis as up', async () => {
    const response = await request(httpServer(testApp.app)).get('/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      details: { database: { status: 'up' }, redis: { status: 'up' } },
    });
  });

  // Regression for S2.4: the global JwtAuthGuard (APP_GUARD) now runs on every route by default.
  // Without @Public() on HealthController, this request would 401 and the Docker healthchecks
  // (compose.yaml) plus CI would break the whole stack.
  it('still returns 200 with no Authorization header now that the global JwtAuthGuard is active', async () => {
    const response = await request(httpServer(testApp.app)).get('/v1/health');

    expect(response.status).toBe(200);
    expect(response.status).not.toBe(401);
  });
});
