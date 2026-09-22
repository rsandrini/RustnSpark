import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { EnvService } from '../../src/common/env/env.module.js';
import { configureApp } from '../../src/main.js';

// Targets the compose `test` profile's tmpfs Postgres/Redis (D9): run
// `docker compose --profile test up -d --wait postgres-test redis-test` before `pnpm test:e2e`.
const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3100',
  DATABASE_URL: 'postgresql://rustandspark:rustandspark@127.0.0.1:5433/rustandspark_test',
  REDIS_URL: 'redis://127.0.0.1:6380',
  CORS_ORIGINS: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  COOKIE_SECRET: 'b'.repeat(32),
};

function httpServer(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

describe('GET /v1/health against the real compose stack', () => {
  let app: INestApplication;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, app.get(EnvService));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    process.env = { ...originalEnv };
  });

  it('reports both database and redis as up', async () => {
    const response = await request(httpServer(app)).get('/v1/health');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      details: { database: { status: 'up' }, redis: { status: 'up' } },
    });
  });
});
