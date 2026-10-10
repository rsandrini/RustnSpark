import { Injectable } from '@nestjs/common';
import type { Prisma, TuningRevision } from '@prisma/client';
import { CONFIG_REGISTRY, getRegistryEntry } from '../../config/config-registry.js';
import { GameConfigRepository } from '../../config/game-config.repository.js';
import { GameConfigService } from '../../config/game-config.service.js';
import { validateConfigValue } from '../../config/game-rules.schema.js';
import {
  GameConfigValidationError,
  type ConfigRegistryEntry,
} from '../../config/game-config.types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ConfigReferenceValidator } from './config-reference.validator.js';
import type { BundleEntryDto } from './dto/index.js';

export interface BundleExportEntry {
  key: string;
  value: unknown;
  factoryDefault: unknown;
  type: string;
}

export interface BundleExport {
  version: number;
  exportedAt: string;
  entries: BundleExportEntry[];
}

export interface BundleDiff {
  key: string;
  before: unknown;
  after: unknown;
}

interface ValidatedBundleEntry {
  key: string;
  value: unknown;
  before: unknown;
  registryEntry: ConfigRegistryEntry;
}

@Injectable()
export class BundleService {
  constructor(
    private readonly gameConfigRepository: GameConfigRepository,
    private readonly gameConfigService: GameConfigService,
    private readonly prisma: PrismaService,
    private readonly references: ConfigReferenceValidator,
  ) {}

  async export(): Promise<BundleExport> {
    const rows = await this.gameConfigRepository.findAll();
    const rowsByKey = new Map(rows.map((row) => [row.key, row.value]));
    const latest = await this.gameConfigRepository.findLatestRevision();

    return {
      version: Number(latest?.id ?? 0n),
      exportedAt: new Date().toISOString(),
      entries: CONFIG_REGISTRY.map((entry) => ({
        key: entry.key,
        value: rowsByKey.has(entry.key)
          ? structuredClone(rowsByKey.get(entry.key))
          : structuredClone(entry.factoryDefault),
        factoryDefault: entry.factoryDefault,
        type: entry.type,
      })),
    };
  }

  async dryRun(entries: BundleEntryDto[]): Promise<{ valid: true; diffs: BundleDiff[] }> {
    const rows = await this.gameConfigRepository.findAll();
    const rowsByKey = new Map(rows.map((row) => [row.key, row.value]));

    const diffs: BundleDiff[] = [];
    const validated: { key: string; value: unknown }[] = [];
    for (const entry of entries) {
      const { value, before } = this.validateBundleEntry(entry, rowsByKey);
      await this.references.assertReferences(entry.key, value);
      validated.push({ key: entry.key, value });
      diffs.push({ key: entry.key, before, after: value });
    }
    return { valid: true, diffs };
  }

  async import(entries: BundleEntryDto[], actor: string): Promise<TuningRevision[]> {
    const rows = await this.gameConfigRepository.findAll();
    const rowsByKey = new Map(rows.map((row) => [row.key, row.value]));

    const validated: ValidatedBundleEntry[] = entries.map((entry) =>
      this.validateBundleEntry(entry, rowsByKey),
    );
    for (const entry of validated) {
      await this.references.assertReferences(entry.key, entry.value);
    }

    const revisions = await this.prisma.$transaction(async (tx) => {
      const created: TuningRevision[] = [];
      for (const update of validated) {
        await this.gameConfigRepository.upsert(
          update.key,
          update.value,
          update.registryEntry.type,
          update.registryEntry.description,
          actor,
          tx,
        );
        const rev = await this.gameConfigRepository.createRevision(
          {
            actor,
            entityType: 'GameConfig',
            entityId: update.key,
            before: update.before as Prisma.InputJsonValue,
            after: update.value as Prisma.InputJsonValue,
            reason: 'bundle import',
          },
          tx,
        );
        created.push(rev);
      }
      return created;
    });

    await this.gameConfigService.refresh();
    return revisions;
  }

  private validateBundleEntry(
    entry: BundleEntryDto,
    rowsByKey: Map<string, unknown>,
  ): ValidatedBundleEntry {
    const registryEntry = getRegistryEntry(entry.key);
    if (!registryEntry) {
      throw new GameConfigValidationError(`Unknown config key: ${entry.key}`, [
        { key: entry.key, message: 'Unknown key' },
      ]);
    }
    const validated = validateConfigValue(entry.key, entry.value);
    const before = rowsByKey.has(entry.key)
      ? structuredClone(rowsByKey.get(entry.key))
      : structuredClone(registryEntry.factoryDefault);
    return { key: entry.key, value: validated, before, registryEntry };
  }
}
