import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { EnvService } from '../../src/common/env/env.module.js';
import { configureApp } from '../../src/main.js';

// Env satisfied against the compose `test` profile services (postgres-test:5433, redis-test:6380,
// S1.4). Override individual keys via `overrides`; to point at a different Postgres/Redis
// instance use the TEST_DATABASE_URL/TEST_REDIS_URL env vars (documented in .env.example)
// instead, so test-db.ts and this factory stay pointed at the same database.
export function testEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PORT: '3100',
    DATABASE_URL:
      process.env.TEST_DATABASE_URL ??
      'postgresql://rustandspark:rustandspark@127.0.0.1:5433/rustandspark_test',
    REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6380',
    CORS_ORIGINS: 'http://localhost:5173',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    COOKIE_SECRET: 'b'.repeat(32),
    ...overrides,
  };
}

export interface TestApp {
  app: INestApplication;
  // Closes the app and restores process.env to what it was before createTestApp() ran.
  close: () => Promise<void>;
}

// Builds a real Nest app (AppModule wired up exactly like main.ts, hardening included) for
// e2e-style tests that need a running HTTP server. EnvModule reads process.env at module-compile
// time, so this mutates process.env for the app's lifetime; always call close() (e.g. afterAll)
// to restore it, even on failure.
// Note: the hand-rolled ThrottlerGuard (60 req/60s per IP, src/common/guards/throttler.guard.ts)
// applies globally, so a test that fires many requests at one endpoint from the same client can
// trip it within a single test run.
export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const originalEnv = { ...process.env };
  Object.assign(process.env, testEnv(overrides));

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, app.get(EnvService));
  await app.init();

  return {
    app,
    close: async () => {
      await app.close();
      process.env = originalEnv;
    },
  };
}
