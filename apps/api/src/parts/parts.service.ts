import { Injectable } from '@nestjs/common';
import { Prisma, type PartCatalog as PartCatalogRow } from '@prisma/client';
import type { Locale } from '../common/locale/locale.js';
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

function localize(value: Record<string, unknown>, locale: string): string {
  const candidate = value[locale] ?? value['en'];
  return typeof candidate === 'string' ? candidate : '';
}

@Injectable()
export class PartsService {
  constructor(private readonly prisma: PrismaService) {}

  async catalog(locale: Locale): Promise<CatalogItem[]> {
    const rows = await this.prisma.partCatalog.findMany({ where: { active: true }, orderBy: { partType: 'asc' } });
    return rows.map((row) => ({
      partType: row.partType,
      displayName: localize(row.displayName as Record<string, unknown>, locale),
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
  async findPlayerParts(playerId: string): Promise<Prisma.PartInstanceGetPayload<{ include: { partCatalog: true } }>[]> {
    return this.prisma.partInstance.findMany({
      where: { ownerPlayerId: playerId },
      include: { partCatalog: true },
      orderBy: { id: 'asc' },
    });
  }
}
