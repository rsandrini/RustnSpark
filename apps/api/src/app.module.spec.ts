import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';

const originalEnv = { ...process.env };

describe('AppModule', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('compiles with a valid environment', async () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/rustandspark',
      REDIS_URL: 'redis://localhost:6379',
      CORS_ORIGINS: 'http://localhost:5173',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      COOKIE_SECRET: 'b'.repeat(32),
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef.get(AppModule)).toBeInstanceOf(AppModule);
  });

  it('refuses to compile without the required environment', async () => {
    delete process.env.DATABASE_URL;
    await expect(Test.createTestingModule({ imports: [AppModule] }).compile()).rejects.toThrow(
      /DATABASE_URL/,
    );
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
