import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { EnvService } from '../common/env/env.module.js';
import { PrismaService } from './prisma.service.js';

const env = new EnvService({
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/rustandspark',
  REDIS_URL: 'redis://localhost:6379',
  CORS_ORIGINS: ['http://localhost:5173'],
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  COOKIE_SECRET: 'b'.repeat(32),
});

describe('PrismaService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('connects on module init', async () => {
    const connect = jest.spyOn(PrismaClient.prototype, '$connect').mockResolvedValue(undefined);
    const service = new PrismaService(env);
    await service.onModuleInit();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('disconnects on module destroy', async () => {
    const disconnect = jest
      .spyOn(PrismaClient.prototype, '$disconnect')
      .mockResolvedValue(undefined);
    const service = new PrismaService(env);
    await service.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
