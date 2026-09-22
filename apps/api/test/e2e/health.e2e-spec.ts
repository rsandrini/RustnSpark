import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, type TestApp } from '../support/app-factory.js';
import { OwnershipTestModule } from '../support/ownership-test.module.js';

// Targets the compose `test` profile's tmpfs Postgres/Redis (D9): run
// `docker compose --profile test up -d --wait postgres-test redis-test` before `pnpm test:e2e`.

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

describe('GET /v1/health against the real compose stack', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    // OwnershipTestModule adds a non-public route to this boot so the spec can self-prove the
    // global guard is genuinely active (see the 401 test below) instead of trusting wiring.
    testApp = await createTestApp({}, [OwnershipTestModule]);
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

  // The health 200 above would pass vacuously if the APP_GUARD registration were removed; this
  // assertion proves the guard is active in the same app boot (a non-public route must 401).
  it('returns 401 with no Authorization header on a non-public route in the same app boot', async () => {
    const response = await request(httpServer(testApp.app)).get('/v1/test/widgets/widget-1');

    expect(response.status).toBe(401);
  });
});
