import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EnvModule } from '../env/env.module.js';
import { REDIS_CLIENT, RedisModule } from './redis.module.js';
import type { RedisClient } from './redis-client.js';

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

@Injectable()
class Consumer {
  constructor(@Inject(REDIS_CLIENT) readonly redis: RedisClient) {}
}

// Deliberately does not import RedisModule: the global module must be enough.
@Module({ providers: [Consumer] })
class ConsumerModule {}

describe('RedisModule', () => {
  beforeEach(() => {
    Object.assign(process.env, VALID_ENV);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('is global: other modules inject REDIS_CLIENT without importing RedisModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EnvModule, RedisModule, ConsumerModule],
    }).compile();
    expect(moduleRef.get(Consumer).redis).toBe(moduleRef.get(REDIS_CLIENT));
  });
});
