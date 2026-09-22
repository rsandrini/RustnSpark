import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { GameConfig, Prisma, TuningRevision } from '@prisma/client';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../common/redis/redis.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { getRegistryEntry } from './config-registry.js';
import { GAME_CONFIG_DEFAULTS } from './game-config.defaults.js';
import { validateConfigValue, validateGameRules } from './game-rules.schema.js';
import { GameConfigRepository } from './game-config.repository.js';
import { ConfigNotLoadedError, GameConfigValidationError, type GameRules } from './game-config.types.js';

const CHANGE_CHANNEL = 'gameconfig:changed';

interface ConfigCache {
  version: number;
  hash: string;
  rules: GameRules;
}

export function hashGameRules(rules: GameRules): string {
  return createHash('sha256').update(canonicalJson(rules)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const pairs = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
  );
  return `{${pairs.join(',')}}`;
}

function setValueAtPath(target: Record<string, unknown>, path: string[], value: unknown): void {
  let current: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i += 1) {
    const segment = path[i]!;
    if (typeof current[segment] !== 'object' || current[segment] === null) {
      throw new GameConfigValidationError(`Invalid config key path: ${path.join('.')}`, [
        { key: path.join('.'), message: 'Invalid path' },
      ]);
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[path[path.length - 1]!] = value;
}

@Injectable()
export class GameConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GameConfigService.name);
  private cache: ConfigCache | undefined;
  private subscriber: Redis | undefined;

  constructor(
    private readonly repository: GameConfigRepository,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadBootCache();
    this.subscriber = this.redis.duplicate();
    this.subscriber.on('message', (channel, message) => {
      if (channel !== CHANGE_CHANNEL) return;
      void this.handleChangeMessage(message);
    });
    await this.subscriber.subscribe(CHANGE_CHANNEL);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.unsubscribe(CHANGE_CHANNEL).catch(() => undefined);
      await this.subscriber.quit().catch(() => undefined);
    }
  }

  snapshot(): ConfigCache {
    if (!this.cache) {
      throw new ConfigNotLoadedError();
    }
    return this.cache;
  }

  async byHash(hash: string): Promise<GameRules> {
    const snapshot = await this.repository.findSnapshotByHash(hash);
    if (!snapshot) {
      throw new ConfigNotLoadedError(`Rules snapshot not found for hash ${hash}`);
    }
    return validateGameRules(snapshot.rules);
  }

  async refresh(): Promise<void> {
    await this.loadAndCache();
    await this.publishChange();
  }

  async setValue(key: string, value: unknown, actor: string, reason: string): Promise<TuningRevision> {
    const validated = validateConfigValue(key, value);
    const entry = getRegistryEntry(key);
    if (!entry) {
      throw new GameConfigValidationError(`Unknown config key: ${key}`, [{ key, message: 'Unknown key' }]);
    }

    const before = await this.getCurrentValue(key);
    const revision = await this.prisma.$transaction(async (tx) => {
      await this.repository.upsert(key, validated, entry.type, entry.description, actor, tx);
      const rev = await this.repository.createRevision(
        {
          actor,
          entityType: 'GameConfig',
          entityId: key,
          before: before as Prisma.InputJsonValue,
          after: validated as Prisma.InputJsonValue,
          reason,
        },
        tx,
      );
      await this.loadAndCache(tx);
      return rev;
    });

    await this.publishChange();
    return revision;
  }

  async setValues(
    updates: ReadonlyArray<{ key: string; value: unknown; reason: string }>,
    actor: string,
  ): Promise<TuningRevision[]> {
    const validated = updates.map((update) => {
      const value = validateConfigValue(update.key, update.value);
      const entry = getRegistryEntry(update.key);
      if (!entry) {
        throw new GameConfigValidationError(`Unknown config key: ${update.key}`, [
          { key: update.key, message: 'Unknown key' },
        ]);
      }
      return { ...update, value, entry };
    });

    const revisions = await this.prisma.$transaction(async (tx) => {
      const created: TuningRevision[] = [];
      for (const update of validated) {
        const before = await this.getCurrentValue(update.key, tx);
        await this.repository.upsert(
          update.key,
          update.value,
          update.entry.type,
          update.entry.description,
          actor,
          tx,
        );
        const rev = await this.repository.createRevision(
          {
            actor,
            entityType: 'GameConfig',
            entityId: update.key,
            before: before as Prisma.InputJsonValue,
            after: update.value as Prisma.InputJsonValue,
            reason: update.reason,
          },
          tx,
        );
        created.push(rev);
      }
      await this.loadAndCache(tx);
      return created;
    });

    await this.publishChange();
    return revisions;
  }

  async resetToFactoryDefault(key: string, actor: string, reason: string): Promise<TuningRevision> {
    const entry = getRegistryEntry(key);
    if (!entry) {
      throw new GameConfigValidationError(`Unknown config key: ${key}`, [{ key, message: 'Unknown key' }]);
    }
    return this.setValue(key, structuredClone(entry.factoryDefault), actor, reason);
  }

  async getRevisions(entityType?: string, entityId?: string): Promise<TuningRevision[]> {
    return this.repository.findRevisions({ entityType, entityId });
  }

  async revertRevision(id: bigint, actor: string): Promise<TuningRevision> {
    const revision = await this.repository.findRevisionById(id);
    if (!revision) {
      throw new GameConfigValidationError(`Revision not found: ${id.toString()}`, [
        { key: String(id), message: 'Revision not found' },
      ]);
    }
    if (revision.before === null || revision.before === undefined) {
      throw new GameConfigValidationError(`Cannot revert revision ${id.toString()}: no before state`, [
        { key: revision.entityId, message: 'No before state' },
      ]);
    }
    return this.setValue(revision.entityId, revision.before, actor, `Revert revision ${id.toString()}`);
  }

  private async getCurrentValue(key: string, tx?: Parameters<GameConfigRepository['findByKey']>[1]): Promise<unknown> {
    const row = await this.repository.findByKey(key, tx);
    if (row) return row.value;
    const entry = getRegistryEntry(key);
    return entry ? structuredClone(entry.factoryDefault) : undefined;
  }

  private async loadBootCache(): Promise<void> {
    try {
      await this.loadAndCache();
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error.message : String(error),
        'Game config boot load failed; searching for a previous good snapshot',
      );
      const fallback = await this.repository.findLatestSnapshot();
      if (!fallback) {
        throw error;
      }
      const latestRevision = await this.repository.findLatestRevision();
      this.cache = {
        version: Number(latestRevision?.id ?? 0n),
        hash: fallback.hash,
        rules: validateGameRules(fallback.rules),
      };
      this.logger.error('Restored game config from last good rules snapshot');
    }
  }

  private async loadAndCache(tx?: Parameters<GameConfigRepository['findAll']>[0]): Promise<void> {
    const rows = await this.repository.findAll(tx);
    const merged = this.mergeRows(rows);
    const rules = validateGameRules(merged);
    const hash = hashGameRules(rules);

    const existing = await this.repository.findSnapshotByHash(hash, tx);
    if (!existing) {
      await this.repository.createSnapshot(hash, rules, tx);
    }

    const latestRevision = await this.repository.findLatestRevision(tx);
    this.cache = { version: Number(latestRevision?.id ?? 0n), hash, rules };
  }

  private mergeRows(rows: GameConfig[]): Record<string, unknown> {
    const merged = structuredClone(GAME_CONFIG_DEFAULTS) as Record<string, unknown>;
    for (const row of rows) {
      setValueAtPath(merged, row.key.split('.'), row.value);
    }
    return merged;
  }

  private async publishChange(): Promise<void> {
    if (!this.cache) return;
    const payload = JSON.stringify({ version: this.cache.version, hash: this.cache.hash });
    await this.redis.publish(CHANGE_CHANNEL, payload);
  }

  private async handleChangeMessage(message: string): Promise<void> {
    if (!this.cache) return;
    let payload: { version?: number; hash?: string };
    try {
      payload = JSON.parse(message) as { version?: number; hash?: string };
    } catch {
      return;
    }
    if (typeof payload.version === 'number' && payload.version > this.cache.version) {
      await this.refresh();
    }
  }
}
