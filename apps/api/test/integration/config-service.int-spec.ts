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
    const revisions = await serviceA!.getRevisions('GameConfig', 'economy.start_credits');
    expect(revisions).toHaveLength(0);
  });

  it('resetToFactoryDefault writes the factory default as current and increments version', async () => {
    await serviceA!.setValue('economy.start_credits', 5000, 'tester', 'override');
    const overridden = serviceA!.snapshot();
    expect(overridden.rules.economy.start_credits).toBe(5000);

    await serviceA!.resetToFactoryDefault('economy.start_credits', 'tester', 'reset');
    const reset = serviceA!.snapshot();
    expect(reset.rules.economy.start_credits).toBe(GAME_CONFIG_DEFAULTS.economy.start_credits);
    expect(reset.version).toBeGreaterThan(overridden.version);
  });

  it('revertRevision restores the prior value', async () => {
    const first = await serviceA!.setValue('economy.start_credits', 4000, 'tester', 'set-4000');
    expect(serviceA!.snapshot().rules.economy.start_credits).toBe(4000);

    await serviceA!.revertRevision(first.id, 'tester');
    const reverted = serviceA!.snapshot();
    expect(reverted.rules.economy.start_credits).toBe(GAME_CONFIG_DEFAULTS.economy.start_credits);
    expect(reverted.version).toBeGreaterThan(Number(first.id));
  });

  it('setValues bundle writes all keys atomically and creates one revision per key', async () => {
    const revisions = await serviceA!.setValues(
      [
        { key: 'economy.start_credits', value: 3000, reason: 'bundle-1' },
        { key: 'combat.dc_base', value: 12, reason: 'bundle-2' },
      ],
      'tester',
    );
    expect(revisions).toHaveLength(2);

    const snapshot = serviceA!.snapshot();
    expect(snapshot.rules.economy.start_credits).toBe(3000);
    expect(snapshot.rules.combat.dc_base).toBe(12);

    await expect(
      serviceA!.setValues(
        [
          { key: 'economy.start_credits', value: 3500, reason: 'bundle-3' },
          { key: 'combat.dc_base', value: 999, reason: 'bundle-bad' },
        ],
        'tester',
      ),
    ).rejects.toBeInstanceOf(GameConfigValidationError);

    const afterFailed = serviceA!.snapshot();
    expect(afterFailed.rules.economy.start_credits).toBe(3000);
    expect(afterFailed.rules.combat.dc_base).toBe(12);
    expect(await serviceA!.getRevisions('GameConfig')).toHaveLength(2);
  });
});
