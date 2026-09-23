import { Injectable } from '@nestjs/common';
import type { Prisma, TuningRevision } from '@prisma/client';
import { CONFIG_REGISTRY, getRegistryEntry } from '../../config/config-registry.js';
import { GameConfigRepository } from '../../config/game-config.repository.js';
import { GameConfigService } from '../../config/game-config.service.js';
import { validateConfigValue } from '../../config/game-rules.schema.js';
import { GameConfigValidationError, type ConfigRegistryEntry } from '../../config/game-config.types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConfigReferenceValidator } from './config-reference.validator.js';
import { RevisionService } from './revision.service.js';
import type {
  ConfigEntryResponse,
  ResetConfigValueDto,
  RevertRevisionDto,
  UpdateConfigValueDto,
} from './dto/index.js';

export class RevisionMismatchError extends Error {
  constructor(public readonly currentRevision: number) {
    super(`Expected revision mismatch; current revision is ${currentRevision}`);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a)) {
    const aa = a as unknown[];
    const bb = b as unknown[];
    if (aa.length !== bb.length) return false;
    return aa.every((value, index) => deepEqual(value, bb[index]));
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keysA = Object.keys(ao);
  const keysB = Object.keys(bo);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => keysB.includes(key) && deepEqual(ao[key], bo[key]));
}

@Injectable()
export class ConfigTuningService {
  constructor(
    private readonly gameConfigService: GameConfigService,
    private readonly gameConfigRepository: GameConfigRepository,
    private readonly revisionService: RevisionService,
    private readonly prisma: PrismaService,
    private readonly references: ConfigReferenceValidator,
  ) {}

  async list(): Promise<ConfigEntryResponse[]> {
    const rows = await this.gameConfigRepository.findAll();
    const rowsByKey = new Map(rows.map((row) => [row.key, row.value]));

    return CONFIG_REGISTRY.map((entry) => {
      const currentValue = rowsByKey.has(entry.key)
        ? structuredClone(rowsByKey.get(entry.key))
        : structuredClone(entry.factoryDefault);
      const modified = rowsByKey.has(entry.key) && !deepEqual(rowsByKey.get(entry.key), entry.factoryDefault);

      return {
        key: entry.key,
        group: entry.group,
        type: entry.type,
        min: entry.min,
        max: entry.max,
        unit: entry.unit,
        description: entry.description,
        currentValue,
        factoryDefault: entry.factoryDefault,
        modified,
      };
    });
  }

  async update(key: string, dto: UpdateConfigValueDto, actor: string): Promise<TuningRevision> {
    const entry = this.resolveEntry(key);
    const validated = validateConfigValue(key, dto.value);
    await this.references.assertReferences(key, validated);

    const revision = await this.prisma.$transaction(async (tx) => {
      await this.assertExpectedRevision(dto.expectedRevision, tx);
      const before = await this.getCurrentValue(key, tx);
      await this.gameConfigRepository.upsert(key, validated, entry.type, entry.description, actor, tx);
      return this.createRevision(actor, key, before, validated, dto.reason, tx);
    });

    await this.gameConfigService.refresh();
    return revision;
  }

  async reset(key: string, dto: ResetConfigValueDto, actor: string): Promise<TuningRevision> {
    const entry = this.resolveEntry(key);
    const factoryDefault = structuredClone(entry.factoryDefault);
    const validated = validateConfigValue(key, factoryDefault);
    await this.references.assertReferences(key, validated);

    const revision = await this.prisma.$transaction(async (tx) => {
      await this.assertExpectedRevision(dto.expectedRevision, tx);
      const before = await this.getCurrentValue(key, tx);
      await this.gameConfigRepository.upsert(key, validated, entry.type, entry.description, actor, tx);
      return this.createRevision(actor, key, before, validated, dto.reason, tx);
    });

    await this.gameConfigService.refresh();
    return revision;
  }

  async revertRevision(id: bigint, dto: RevertRevisionDto, actor: string): Promise<TuningRevision> {
    const target = await this.revisionService.findById(id);
    if (!target) {
      throw new GameConfigValidationError(`Revision not found: ${id.toString()}`, [
        { key: String(id), message: 'Revision not found' },
      ]);
    }
    if (target.before === null || target.before === undefined) {
      throw new GameConfigValidationError(`Cannot revert revision ${id.toString()}: no before state`, [
        { key: target.entityId, message: 'No before state' },
      ]);
    }

    const entry = this.resolveEntry(target.entityId);
    const validated = validateConfigValue(target.entityId, target.before);
    await this.references.assertReferences(target.entityId, validated);

    const revision = await this.prisma.$transaction(async (tx) => {
      const before = await this.getCurrentValue(target.entityId, tx);
      await this.gameConfigRepository.upsert(target.entityId, validated, entry.type, entry.description, actor, tx);
      return this.createRevision(actor, target.entityId, before, validated, dto.reason, tx);
    });

    await this.gameConfigService.refresh();
    return revision;
  }

  private resolveEntry(key: string): ConfigRegistryEntry {
    const entry = getRegistryEntry(key);
    if (!entry) {
      throw new GameConfigValidationError(`Unknown config key: ${key}`, [{ key, message: 'Unknown key' }]);
    }
    return entry;
  }

  private async assertExpectedRevision(
    expected: number,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const latest = await this.gameConfigRepository.findLatestRevision(tx);
    const currentRevision = Number(latest?.id ?? 0n);
    if (expected !== currentRevision) {
      throw new RevisionMismatchError(currentRevision);
    }
  }

  private async getCurrentValue(key: string, tx: Prisma.TransactionClient): Promise<unknown> {
    const row = await this.gameConfigRepository.findByKey(key, tx);
    if (row) return row.value;
    const entry = getRegistryEntry(key);
    return entry ? structuredClone(entry.factoryDefault) : undefined;
  }

  private createRevision(
    actor: string,
    key: string,
    before: unknown,
    after: unknown,
    reason: string,
    tx: Prisma.TransactionClient,
  ): Promise<TuningRevision> {
    return this.gameConfigRepository.createRevision(
      {
        actor,
        entityType: 'GameConfig',
        entityId: key,
        before: before as Prisma.InputJsonValue,
        after: after as Prisma.InputJsonValue,
        reason,
      },
      tx,
    );
  }
}
