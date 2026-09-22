import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EnvModule, EnvService } from './env.module.js';

const VALID_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3100',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/rustandspark',
  REDIS_URL: 'redis://localhost:6379',
  CORS_ORIGINS: 'http://localhost:5173',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  COOKIE_SECRET: 'b'.repeat(32),
};

const originalEnv = { ...process.env };

function setEnv(values: Record<string, string | undefined>): void {
  for (const key of Object.keys(VALID_ENV)) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

@Injectable()
class Consumer {
  constructor(readonly env: EnvService) {}
}

// Deliberately does not import EnvModule: the global module must be enough.
@Module({ providers: [Consumer] })
class ConsumerModule {}

describe('EnvModule', () => {
  beforeEach(() => setEnv(VALID_ENV));
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('provides typed values through EnvService.get', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [EnvModule] }).compile();
    const env = moduleRef.get(EnvService);
    expect(env.get('PORT')).toBe(3100);
    expect(env.get('CORS_ORIGINS')).toEqual(['http://localhost:5173']);
    expect(env.get('DATABASE_URL')).toBe(VALID_ENV.DATABASE_URL);
  });

  it('is global: other modules inject EnvService without importing EnvModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EnvModule, ConsumerModule],
    }).compile();
    expect(moduleRef.get(Consumer).env.get('NODE_ENV')).toBe('test');
  });

  it('refuses to boot when a variable is missing', async () => {
    setEnv({ ...VALID_ENV, DATABASE_URL: undefined });
    await expect(Test.createTestingModule({ imports: [EnvModule] }).compile()).rejects.toThrow(
      /DATABASE_URL/,
    );
  });

  it('refuses to boot when a variable is invalid', async () => {
    setEnv({ ...VALID_ENV, COOKIE_SECRET: 'too-short' });
    await expect(Test.createTestingModule({ imports: [EnvModule] }).compile()).rejects.toThrow(
      /COOKIE_SECRET/,
    );
  });
});
