import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../src/common/redis/redis.module.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { GameConfigRepository } from '../../../src/config/game-config.repository.js';
import { GameConfigService, hashGameRules } from '../../../src/config/game-config.service.js';
import { ConfigNotLoadedError, type GameRules } from '../../../src/config/game-config.types.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';

type MockedRepository = jest.Mocked<
  Pick<
    GameConfigRepository,
    | 'findAll'
    | 'findByKey'
    | 'upsert'
    | 'findSnapshotByHash'
    | 'createSnapshot'
    | 'findLatestSnapshot'
    | 'createRevision'
    | 'findLatestRevision'
    | 'findRevisionById'
  >
>;

function buildMockRepository(): MockedRepository {
  return {
    findAll: jest.fn(),
    findByKey: jest.fn(),
    upsert: jest.fn(),
    findSnapshotByHash: jest.fn(),
    createSnapshot: jest.fn(),
    findLatestSnapshot: jest.fn(),
    createRevision: jest.fn(),
    findLatestRevision: jest.fn(),
    findRevisionById: jest.fn(),
  };
}

function buildMockRedis(): Redis {
  const subscriber = {
    connect: jest.fn(() => Promise.resolve(undefined)),
    subscribe: jest.fn(() => Promise.resolve(undefined)),
    unsubscribe: jest.fn(() => Promise.resolve(undefined)),
    quit: jest.fn(() => Promise.resolve(undefined)),
    on: jest.fn(() => subscriber),
  } as unknown as Redis;
  const redis = {
    publish: jest.fn(() => Promise.resolve(1)),
    duplicate: jest.fn(() => subscriber),
    connect: jest.fn(() => Promise.resolve(undefined)),
    quit: jest.fn(() => Promise.resolve(undefined)),
    on: jest.fn(() => redis),
  } as unknown as Redis;
  return redis;
}

describe('hashGameRules', () => {
  it('is deterministic for the same rules', () => {
    expect(hashGameRules(GAME_CONFIG_DEFAULTS)).toBe(hashGameRules(GAME_CONFIG_DEFAULTS));
  });

  it('ignores key insertion order in canonical JSON', () => {
    const reordered = {
      combat: GAME_CONFIG_DEFAULTS.combat,
      admin: GAME_CONFIG_DEFAULTS.admin,
      economy: GAME_CONFIG_DEFAULTS.economy,
      ship: GAME_CONFIG_DEFAULTS.ship,
      wear: GAME_CONFIG_DEFAULTS.wear,
      encounter: GAME_CONFIG_DEFAULTS.encounter,
      escape: GAME_CONFIG_DEFAULTS.escape,
      detection: GAME_CONFIG_DEFAULTS.detection,
      stance: GAME_CONFIG_DEFAULTS.stance,
      failure: GAME_CONFIG_DEFAULTS.failure,
      integrity: GAME_CONFIG_DEFAULTS.integrity,
      mining: GAME_CONFIG_DEFAULTS.mining,
      race: GAME_CONFIG_DEFAULTS.race,
      rescue: GAME_CONFIG_DEFAULTS.rescue,
      escort: GAME_CONFIG_DEFAULTS.escort,
      ship_class: GAME_CONFIG_DEFAULTS.ship_class,
      missions: GAME_CONFIG_DEFAULTS.missions,
      scavenging: GAME_CONFIG_DEFAULTS.scavenging,
      parts: GAME_CONFIG_DEFAULTS.parts,
      onboarding: GAME_CONFIG_DEFAULTS.onboarding,
      world: GAME_CONFIG_DEFAULTS.world,
    } as unknown as GameRules;

    expect(hashGameRules(reordered)).toBe(hashGameRules(GAME_CONFIG_DEFAULTS));
  });
});

describe('GameConfigService cache', () => {
  let service: GameConfigService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        GameConfigService,
        { provide: GameConfigRepository, useValue: buildMockRepository() },
        { provide: PrismaService, useValue: {} },
        { provide: REDIS_CLIENT, useValue: buildMockRedis() },
      ],
    }).compile();
    service = module.get(GameConfigService);
  });

  it('throws ConfigNotLoadedError before refresh() is called', () => {
    expect(() => service.snapshot()).toThrow(ConfigNotLoadedError);
  });
});
