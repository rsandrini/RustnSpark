import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PartCatalog as PartCatalogRow } from '@prisma/client';
import type { Locale } from '../common/locale/locale.js';
import { localizeDisplayName } from '../common/locale/localize.js';
import { resolveRequestLocale } from '../common/locale/request-locale.js';
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PartCatalog } from './part.types.js';

export interface CatalogItem {
  partType: string;
  displayName: string;
  partClass: string;
}

/** What a detail popup shows for a catalog entry (report references, S10.8). */
export interface CatalogDetail {
  readonly id: string;
  readonly kind: 'part' | 'material';
  readonly displayName: { en: string; 'pt-BR': string };
  readonly description: { en: string; 'pt-BR': string };
  /** Part class (parts) or rarity (materials). */
  readonly category: string;
  readonly rarity: string;
}

export interface InventoryItem {
  id: string;
  partType: string;
  /** Both locales, like the market and scavenging: the client picks one, never shows the code. */
  displayName: { en: string; 'pt-BR': string };
  description: { en: string; 'pt-BR': string };
  rarity: string;
  condition: number;
  /** At or below the wear threshold the part is dead: it counts for nothing until repaired. */
  broken: boolean;
  location: string;
  shipId: string | null;
  catalog: PartCatalog;
}

export function bilingual(value: unknown): { en: string; 'pt-BR': string } {
  const record = (value ?? {}) as Record<string, unknown>;
  return {
    en: localizeDisplayName(record, 'en'),
    'pt-BR': localizeDisplayName(record, 'pt-BR'),
  };
}

function readFlag(specialProp: unknown, key: string): boolean {
  if (typeof specialProp !== 'object' || specialProp === null) {
    return false;
  }
  return (specialProp as Record<string, unknown>)[key] === true;
}

export function pickCatalogStats(row: PartCatalogRow): PartCatalog {
  return {
    partType: row.partType,
    partClass: row.partClass,
    w: row.w,
    h: row.h,
    mass: row.mass,
    structureCost: row.structureCost,
    partHp: row.partHp,
    basePrice: row.basePrice,
    pot: row.pot ?? 0,
    pdf: row.pdf ?? 0,
    bli: row.bli ?? 0,
    esc: row.esc ?? 0,
    sen: row.sen ?? 0,
    crg: row.crg ?? 0,
    min: row.min ?? 0,
    energyCont: row.energyCont ?? 0,
    energyCombat: row.energyCombat ?? 0,
    fuelCap: row.fuelCap ?? 0,
    fuelUse: row.fuelUse ?? 0,
    batCharge: row.batCharge ?? 0,
    batOutput: row.batOutput ?? 0,
    batInput: row.batInput ?? 0,
    pressurized: readFlag(row.specialProp, 'pressurized'),
    lifeSupport: readFlag(row.specialProp, 'lifeSupport'),
  };
}

@Injectable()
export class PartsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
  ) {}

  // An explicit ?locale= wins; otherwise the player's saved locale, then the
  // default — precedence lives in resolveRequestLocale (S9.2, shared with
  // reports). The player row is only read when there is no explicit value.
  async catalogForPlayer(playerId: string, explicit: string | undefined): Promise<CatalogItem[]> {
    const saved =
      explicit === undefined
        ? (
            await this.prisma.player.findUnique({
              where: { id: playerId },
              select: { locale: true },
            })
          )?.locale
        : undefined;
    return this.catalog(resolveRequestLocale(explicit, saved));
  }

  async catalog(locale: Locale): Promise<CatalogItem[]> {
    const rows = await this.prisma.partCatalog.findMany({
      where: { active: true },
      orderBy: { partType: 'asc' },
    });
    return rows.map((row) => ({
      partType: row.partType,
      displayName: localizeDisplayName(row.displayName as Record<string, unknown>, locale),
      partClass: row.partClass,
    }));
  }

  // Read-only catalog lookups for the report popups. Unknown or retired entries are 404: a
  // stored log may name a part that has since left the catalog, and the popup handles that.
  async partDetail(partType: string): Promise<CatalogDetail> {
    const row = await this.prisma.partCatalog.findUnique({ where: { partType } });
    if (!row) throw new NotFoundException('part not found');
    return {
      id: row.partType,
      kind: 'part',
      displayName: bilingual(row.displayName),
      description: bilingual(row.description),
      category: row.partClass,
      rarity: row.rarity,
    };
  }

  async materialDetail(id: string): Promise<CatalogDetail> {
    const row = await this.prisma.material.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('material not found');
    return {
      id: row.id,
      kind: 'material',
      displayName: bilingual(row.displayName),
      description: bilingual(row.description),
      category: row.rarity,
      rarity: row.rarity,
    };
  }

  async inventory(playerId: string): Promise<InventoryItem[]> {
    // Through findPlayerParts so a repair in progress shows its gradual condition here too.
    const rows = await this.findPlayerParts(playerId);
    return rows.map((row) => ({
      id: row.id,
      partType: row.partType,
      displayName: {
        en: localizeDisplayName(row.partCatalog.displayName as Record<string, unknown>, 'en'),
        'pt-BR': localizeDisplayName(
          row.partCatalog.displayName as Record<string, unknown>,
          'pt-BR',
        ),
      },
      description: bilingual(row.partCatalog.description),
      rarity: row.partCatalog.rarity,
      condition: row.condition,
      broken: row.condition <= this.config.snapshot().rules.wear.dead_at_or_below,
      location: row.location,
      shipId: row.shipId,
      catalog: pickCatalogStats(row.partCatalog),
    }));
  }

  /**
   * Destroys every part in storage that is too damaged to sell (below `economy.sell_min_condition`):
   * no port takes them, so this is the way to clear them out. Installed parts are never touched.
   * Naturally idempotent: a second call finds nothing.
   */
  async discardDamaged(playerId: string): Promise<{ discarded: number }> {
    const threshold = this.config.snapshot().rules.economy.sell_min_condition;
    const events = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.partInstance.findMany({
        where: { ownerPlayerId: playerId, location: 'INVENTORY', condition: { lt: threshold } },
        select: { id: true, partType: true },
      });
      if (rows.length === 0) return 0;
      await tx.partInstance.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
      await tx.playerEvent.create({
        data: {
          playerId,
          type: 'inventory.discard',
          payload: { count: rows.length, partTypes: rows.map((row) => row.partType) },
        },
      });
      return rows.length;
    });
    return { discarded: events };
  }

  // Ship assembly operates on a player's parts; this returns them with catalog stats attached.
  // An optional tx keeps the read inside a caller's transaction (S7.2 dispatch).
  async findPlayerParts(
    playerId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.PartInstanceGetPayload<{ include: { partCatalog: true } }>[]> {
    const client = tx ?? this.prisma;
    const rows = await client.partInstance.findMany({
      where: { ownerPlayerId: playerId },
      include: { partCatalog: true },
      orderBy: { id: 'asc' },
    });
    const jobs = await client.repairJob.findMany({
      where: { playerId, status: 'PENDING' },
      select: { targets: true, startedAt: true, completesAt: true },
    });
    if (jobs.length === 0) return rows;
    // A repair in progress restores condition gradually: the part shows the share of the work
    // done so far (whole points, never past the target). The stored value is written at the end.
    const now = Date.now();
    const live = new Map<string, number>();
    for (const job of jobs) {
      const span = job.completesAt.getTime() - job.startedAt.getTime();
      const done = span <= 0 ? 1 : Math.min(1, Math.max(0, (now - job.startedAt.getTime()) / span));
      for (const target of repairTargetsOf(job.targets)) {
        const value = target.fromCondition + (target.toCondition - target.fromCondition) * done;
        live.set(target.partInstanceId, Math.floor(value));
      }
    }
    return rows.map((row) => {
      const value = live.get(row.id);
      return value === undefined ? row : { ...row, condition: Math.max(row.condition, value) };
    });
  }
}

interface RepairTargetRow {
  readonly partInstanceId: string;
  readonly fromCondition: number;
  readonly toCondition: number;
}

function repairTargetsOf(raw: unknown): RepairTargetRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const c = entry as Record<string, unknown> | null;
    if (
      c === null ||
      typeof c !== 'object' ||
      typeof c['partInstanceId'] !== 'string' ||
      typeof c['fromCondition'] !== 'number' ||
      typeof c['toCondition'] !== 'number'
    ) {
      return [];
    }
    return [
      {
        partInstanceId: c['partInstanceId'],
        fromCondition: c['fromCondition'],
        toCondition: c['toCondition'],
      },
    ];
  });
}
