import { afterAll, afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { GAME_CONFIG_DEFAULTS } from '../../src/config/game-config.defaults.js';
import { ConfigModule } from '../../src/config/config.module.js';
import { GameConfigRepository } from '../../src/config/game-config.repository.js';
import { GameConfigService } from '../../src/config/game-config.service.js';
import { GameConfigValidationError } from '../../src/config/game-config.types.js';
import { REDIS_CLIENT } from '../../src/common/redis/redis.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { testEnv } from '../support/app-factory.js';
import { closeTestPrismaClient, getTestPrismaClient, resetDatabase } from '../support/test-db.js';

describe('GameConfigService integration', () => {
  const originalEnv = { ...process.env };
  const prisma = getTestPrismaClient();

  let module: INestApplicationContext | undefined;
  let serviceA: GameConfigService | undefined;

  beforeEach(async () => {
    Object.assign(process.env, testEnv());
    module = await Test.createTestingModule({ imports: [ConfigModule] }).compile();
    await module.init();
    serviceA = module.get(GameConfigService);
  });

  afterEach(async () => {
    await module?.close();
    module = undefined;
    serviceA = undefined;
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await closeTestPrismaClient();
    process.env = originalEnv;
  });

  it('snapshot() returns the factory defaults before any override', () => {
    const snapshot = serviceA!.snapshot();
    expect(snapshot.rules).toEqual(GAME_CONFIG_DEFAULTS);
    expect(snapshot.version).toBe(0);
    expect(snapshot.hash).toBeTruthy();
  });

  it('propagates a change to a second instance within 2 seconds via Redis pub/sub', async () => {
    const repository = module!.get(GameConfigRepository);
    const prismaService = module!.get(PrismaService);
    const redis = module!.get<Redis>(REDIS_CLIENT);
    const redisB = redis.duplicate();
    const serviceB = new GameConfigService(repository, prismaService, redisB);
    await serviceB.onModuleInit();

    try {
      const initial = serviceB.snapshot();
      await serviceA!.setValue('economy.start_credits', 9999, 'tester', 'integration-test');

      const deadline = Date.now() + 2000;
      let current = serviceB.snapshot();
      while (current.version === initial.version && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        current = serviceB.snapshot();
      }

      expect(current.version).toBeGreaterThan(initial.version);
      expect(current.rules.economy.start_credits).toBe(9999);
    } finally {
      await serviceB.onModuleDestroy();
      await redisB.quit();
    }
  }, 10000);

  async function writeWithoutPublishing(key: string, value: unknown): Promise<void> {
    const repository = module!.get(GameConfigRepository);
    const prismaService = module!.get(PrismaService);
    await prismaService.$transaction(async (tx) => {
      await repository.upsert(key, value, 'INTEGER', { en: 'x', 'pt-BR': 'x' }, 'tester', tx);
      await repository.createRevision(
        { actor: 'tester', entityType: 'GameConfig', entityId: key, before: null as never, after: value as never, reason: 'silent write' },
        tx,
      );
    });
  }

  it('self-heals via the version poll when a pub/sub message was missed', async () => {
    await writeWithoutPublishing('economy.start_credits', 4321);
    expect(serviceA!.snapshot().rules.economy.start_credits).not.toBe(4321);

    await serviceA!.pollForChanges();

    expect(serviceA!.snapshot().rules.economy.start_credits).toBe(4321);
  });

  it('keeps the last good snapshot and does not throw when a reload fails', async () => {
    const before = serviceA!.snapshot();
    await writeWithoutPublishing('economy.start_credits', 'not-a-number');

    await expect(serviceA!.pollForChanges()).resolves.toBeUndefined();

    expect(serviceA!.snapshot().hash).toBe(before.hash);
  });

  it('byHash(snapshot().hash) returns the same rules', async () => {
    const snapshot = serviceA!.snapshot();
    const fromHash = await serviceA!.byHash(snapshot.hash);
    expect(fromHash).toEqual(snapshot.rules);
  });

  it('rejects an out-of-bounds value without writing a revision or changing the cache', async () => {
    const before = serviceA!.snapshot();
    await expect(
      serviceA!.setValue('economy.start_credits', 999999, 'tester', 'bad'),
    ).rejects.toBeInstanceOf(GameConfigValidationError);

    const after = serviceA!.snapshot();
    expect(after.version).toBe(before.version);
    expect(after.rules.economy.start_credits).toBe(before.rules.economy.start_credits);
    expect(await prisma.tuningRevision.count({ where: { entityId: 'economy.start_credits' } })).toBe(0);
  });
});
