import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EnvModule } from '../common/env/env.module.js';
import { PrismaModule } from './prisma.module.js';
import { PrismaService } from './prisma.service.js';

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
  constructor(readonly prisma: PrismaService) {}
}

// Deliberately does not import PrismaModule: the global module must be enough.
@Module({ providers: [Consumer] })
class ConsumerModule {}

describe('PrismaModule', () => {
  beforeEach(() => {
    Object.assign(process.env, VALID_ENV);
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('is global: other modules inject PrismaService without importing PrismaModule', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [EnvModule, PrismaModule, ConsumerModule],
    }).compile();
    // Same singleton as the one PrismaModule provides, proving the global export reached Consumer.
    expect(moduleRef.get(Consumer).prisma).toBe(moduleRef.get(PrismaService));
  });
});
