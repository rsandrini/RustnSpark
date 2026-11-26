import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createRng } from '../common/rng/rng.js';
import { GameConfigService } from '../config/game-config.service.js';
import { SCRAP_MATERIAL_ID } from '../economy/scrap.js';
import {
  rollScrapYield,
  scrapYieldRange,
  type ScrapRarity,
  type ScrapYieldInput,
  type ScrapYieldRules,
} from '../economy/scrap-yield.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { partsUnderRepair } from './under-repair.js';

export const PART_SCRAPPED_EVENT = 'inventory.scrap';

export interface ScrapQuote {
  readonly partInstanceId: string;
  readonly min: number;
  readonly max: number;
  readonly chance: number;
}

export interface ScrapResult {
  readonly partInstanceId: string;
  readonly base: number;
  readonly bonus: number;
  readonly pieces: number;
  /** How much scrap the pilot holds after this. */
  readonly scrapHeld: number;
}

interface ScrapCandidate {
  readonly id: string;
  readonly ownerPlayerId: string;
  readonly location: string;
  readonly condition: number;
  readonly partType: string;
  readonly partCatalog: {
    partClass: string;
    rarity: string;
    w: number;
    h: number;
    basePrice: number;
    scrapValue: number;
  };
}

/**
 * Turns one loose part into generic scrap (TODO v0.1.5 item 10). Any part in storage but the
 * bridge. The yield is `economy.scrap_*` (economy/scrap-yield.ts) and is fixed for a part: the
 * dice are seeded from the part instance id, so quoting or retrying cannot re-roll it. The quote
 * therefore shows only the range and the odds.
 */
@Injectable()
export class ScrapPartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
  ) {}

  async quote(playerId: string, partInstanceId: string): Promise<ScrapQuote> {
    const part = await this.load(this.prisma, playerId, partInstanceId);
    this.assertScrappable(part);
    const range = scrapYieldRange(this.input(part), await this.rules(this.prisma));
    return { partInstanceId, ...range };
  }

  async scrap(playerId: string, partInstanceId: string): Promise<ScrapResult> {
    return this.prisma.$transaction(async (tx) => {
      const part = await this.load(tx, playerId, partInstanceId);
      this.assertScrappable(part);
      if ((await partsUnderRepair(tx, playerId)).has(part.id)) {
        throw new ConflictException({ error: 'PART_IN_REPAIR' });
      }
      // A loose part is a port action like selling it: refused while the ship is out on a mission.
      const ship = await tx.ship.findFirst({
        where: { ownerPlayerId: playerId },
        orderBy: { id: 'asc' },
        select: { status: true },
      });
      if (ship?.status === 'ON_MISSION') throw new ConflictException({ error: 'SHIP_ON_MISSION' });

      const scrapMaterial = await tx.material.findUnique({
        where: { id: SCRAP_MATERIAL_ID },
        select: { id: true },
      });
      if (scrapMaterial === null) throw new ConflictException({ error: 'PART_NOT_SCRAPPABLE' });

      const input = this.input(part);
      const result = rollScrapYield(input, await this.rules(tx), createRng(`scrap:${part.id}`));

      // The delete is the race guard: only one transaction can remove the row, so only one grants.
      const removed = await tx.partInstance.deleteMany({
        where: { id: part.id, ownerPlayerId: playerId, location: 'INVENTORY' },
      });
      if (removed.count === 0) throw new NotFoundException('part not found');

      const held = await tx.playerMaterial.upsert({
        where: { playerId_materialId: { playerId, materialId: SCRAP_MATERIAL_ID } },
        create: { playerId, materialId: SCRAP_MATERIAL_ID, quantity: result.pieces },
        update: { quantity: { increment: result.pieces } },
      });
      await tx.playerEvent.create({
        data: {
          playerId,
          type: PART_SCRAPPED_EVENT,
          payload: {
            partInstanceId: part.id,
            partType: part.partType,
            rarity: part.partCatalog.rarity,
            condition: part.condition,
            base: result.base,
            bonus: result.bonus,
            pieces: result.pieces,
          },
        },
      });
      return { partInstanceId: part.id, ...result, scrapHeld: held.quantity };
    });
  }

  private async load(
    db: Pick<PrismaService, 'partInstance'>,
    playerId: string,
    partInstanceId: string,
  ): Promise<ScrapCandidate> {
    const part = await db.partInstance.findUnique({
      where: { id: partInstanceId },
      select: {
        id: true,
        ownerPlayerId: true,
        location: true,
        condition: true,
        partType: true,
        partCatalog: {
          select: {
            partClass: true,
            rarity: true,
            w: true,
            h: true,
            basePrice: true,
            scrapValue: true,
          },
        },
      },
    });
    if (!part || part.ownerPlayerId !== playerId) throw new NotFoundException('part not found');
    return part;
  }

  private assertScrappable(part: ScrapCandidate): void {
    // A bridge, and a part the catalog says has no scrap value (as in discardDamaged), leave nothing.
    if (part.partCatalog.partClass === 'BRIDGE' || part.partCatalog.scrapValue <= 0) {
      throw new ConflictException({ error: 'PART_NOT_SCRAPPABLE' });
    }
    if (part.location !== 'INVENTORY') throw new ConflictException({ error: 'PART_INSTALLED' });
  }

  private input(part: ScrapCandidate): ScrapYieldInput {
    return {
      rarity: part.partCatalog.rarity as ScrapRarity,
      cells: part.partCatalog.w * part.partCatalog.h,
      condition: part.condition,
      basePrice: part.partCatalog.basePrice,
    };
  }

  private async rules(db: Pick<PrismaService, 'material'>): Promise<ScrapYieldRules> {
    const economy = this.config.snapshot().rules.economy;
    const scrap = await db.material.findUnique({
      where: { id: SCRAP_MATERIAL_ID },
      select: { basePrice: true },
    });
    const complete = (table: Readonly<Record<string, number>>): Record<ScrapRarity, number> => ({
      COMMON: table['COMMON'] ?? 0,
      UNCOMMON: table['UNCOMMON'] ?? 0,
      RARE: table['RARE'] ?? 0,
      EPIC: table['EPIC'] ?? 0,
      LEGENDARY: table['LEGENDARY'] ?? 0,
    });
    return {
      base: complete(economy.scrap_yield_base),
      perExtraCell: economy.scrap_yield_per_cell,
      bonusRolls: economy.scrap_bonus_rolls,
      bonusChance: complete(economy.scrap_bonus_chance),
      sellRatio: economy.sell_ratio,
      sellMinCondition: economy.sell_min_condition,
      scrapUnitPrice: scrap?.basePrice ?? 0,
    };
  }
}
