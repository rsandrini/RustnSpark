import { Injectable } from '@nestjs/common';
import { Prisma, type PartCatalog as PartCatalogRow } from '@prisma/client';
import type { Locale } from '../common/locale/locale.js';
import { localizeDisplayName } from '../common/locale/localize.js';
import { resolveRequestLocale } from '../common/locale/request-locale.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PartCatalog } from './part.types.js';

export interface CatalogItem {
  partType: string;
  displayName: string;
  partClass: string;
}

export interface InventoryItem {
  id: string;
  partType: string;
  condition: number;
  location: string;
  shipId: string | null;
  catalog: PartCatalog;
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
  constructor(private readonly prisma: PrismaService) {}

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

  async inventory(playerId: string): Promise<InventoryItem[]> {
    const rows = await this.prisma.partInstance.findMany({
      where: { ownerPlayerId: playerId },
      include: { partCatalog: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      partType: row.partType,
      condition: row.condition,
      location: row.location,
      shipId: row.shipId,
      catalog: pickCatalogStats(row.partCatalog),
    }));
  }

  // Ship assembly operates on a player's parts; this returns them with catalog stats attached.
  // An optional tx keeps the read inside a caller's transaction (S7.2 dispatch).
  async findPlayerParts(
    playerId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.PartInstanceGetPayload<{ include: { partCatalog: true } }>[]> {
    return (tx ?? this.prisma).partInstance.findMany({
      where: { ownerPlayerId: playerId },
      include: { partCatalog: true },
      orderBy: { id: 'asc' },
    });
  }
}
