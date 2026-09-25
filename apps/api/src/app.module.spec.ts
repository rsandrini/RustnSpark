import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';
import {
  MISSION_QUEUE_NAME,
  PING_QUEUE_NAME,
  RECONCILE_QUEUE_NAME,
  REPAIR_QUEUE_NAME,
} from './jobs/queues.js';

// BullMQ queues connect to Redis the moment they are constructed (no lazy connect like
// RedisClient/PrismaService), and they retry forever. This spec only proves the DI graph
// compiles, so the queues are replaced with inert doubles: a unit run then needs no Redis
// and leaves no open handle (a real queue kept Jest alive for 6 h on a CI runner without
// Redis). The real queue wiring is exercised by test/integration/jobs.int-spec.ts.
const QUEUE_NAMES = [PING_QUEUE_NAME, MISSION_QUEUE_NAME, RECONCILE_QUEUE_NAME, REPAIR_QUEUE_NAME];

function compileApp() {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  for (const name of QUEUE_NAMES) {
    builder = builder
      .overrideProvider(getQueueToken(name))
      .useValue({ add: () => Promise.resolve(), close: () => Promise.resolve() });
  }
  return builder.compile();
}

const originalEnv = { ...process.env };

describe('AppModule', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('compiles with a valid environment', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/rustandspark',
      REDIS_URL: originalEnv.REDIS_URL ?? 'redis://localhost:6379',
      CORS_ORIGINS: 'http://localhost:5173',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      COOKIE_SECRET: 'b'.repeat(32),
    });
    const moduleRef = await compileApp();
    try {
      expect(moduleRef.get(AppModule)).toBeInstanceOf(AppModule);
    } finally {
      await moduleRef.close();
    }
  });

  it('refuses to compile without the required environment', async () => {
    delete process.env.DATABASE_URL;
    await expect(compileApp()).rejects.toThrow(/DATABASE_URL/);
  });
});

// Guards the ESM Jest setup: the `jest` object only exists via @jest/globals.
describe('jest ESM globals', () => {
  it('provides mock functions', () => {
    const fn = jest.fn(() => 'ok');
    expect(fn()).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('provides fake timers', () => {
    jest.useFakeTimers();
    try {
      const fn = jest.fn();
      setTimeout(fn, 1000);
      jest.advanceTimersByTime(1000);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
