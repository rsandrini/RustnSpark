import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Redis } from 'ioredis';
import { EnvService } from '../env/env.module.js';
import { RedisClient } from './redis-client.js';

const env = new EnvService({
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/rustandspark',
  REDIS_URL: 'redis://localhost:6379',
  CORS_ORIGINS: ['http://localhost:5173'],
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  COOKIE_SECRET: 'b'.repeat(32),
});

describe('RedisClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('connects lazily on module init', async () => {
    const connect = jest.spyOn(Redis.prototype, 'connect').mockResolvedValue(undefined);
    const client = new RedisClient(env);
    await client.onModuleInit();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('quits cleanly on module destroy', async () => {
    const quit = jest.spyOn(Redis.prototype, 'quit').mockResolvedValue('OK');
    const client = new RedisClient(env);
    await client.onModuleDestroy();
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
