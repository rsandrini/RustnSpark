import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GameConfigService } from '../config/game-config.service.js';
import { bilingual, pickCatalogStats } from '../parts/parts.service.js';
import type { PartCatalog as PartCatalogStats } from '../parts/part.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { InsufficientFundsError, WalletService } from '../players/wallet.service.js';
import { nextTierPartTypeOf, partUpgradeCost } from './part-upgrade.calculator.js';
import { upgradeNeeds } from './upgrade-materials.js';

export const PART_UPGRADED_EVENT = 'part.upgraded';
const FULL_CONDITION = 100;
const SCRAP = 'scrap';
const SCRAP_PREFIX = 'scrap_';

export interface PartUpgradeQuote {
  readonly partInstanceId: string;
  readonly eligible: boolean;
  readonly reason?: 'MAX_TIER' | 'NO_NEXT_TIER' | 'NOT_FULL_CONDITION';
  readonly nextPartType?: string;
  readonly nextDisplayName?: { en: string; 'pt-BR': string };
  readonly cost?: number;
  /** What the upgrade also asks for besides money, with what the pilot holds of each. */
  readonly materials?: readonly PartUpgradeMaterial[];
  /** Round-10 owner request: the next tier's own rarity, description and full catalog
      stats, so the client can build a virtual part and reuse the same before/after diff
      popup Market already has — the upgrade target doesn't exist as an owned instance yet. */
  readonly nextRarity?: string;
  readonly nextDescription?: { en: string; 'pt-BR': string };
  readonly nextCatalog?: PartCatalogStats;
}

/** One material the upgrade asks for, against what the pilot holds ('scrap' = any scrap). */
export interface PartUpgradeMaterial {
  readonly materialId: string;
  readonly displayName: { en: string; 'pt-BR': string };
  readonly needed: number;
  readonly have: number;
}

export interface PartUpgradeResult {
  readonly partInstanceId: string;
  readonly partType: string;
  readonly displayName: { en: string; 'pt-BR': string };
  readonly rarity: string;
  readonly condition: number;
  readonly cost: number;
  readonly credits: number;
}

/**
 * Round-5 backlog item 4: "upgrade parts in ports". Mechanism only (owner's explicit scope) —
 * eligibility is derived from the catalog's own tier-naming convention
 * (part-upgrade.calculator.ts), never a curated per-part field, so this never has to agree with
 * catalog content decided elsewhere. A part with no next-tier catalog row simply reports
 * ineligible; nothing here assumes any particular family has been chained.
 */
@Injectable()
export class PartUpgradeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly wallet: WalletService,
    private readonly events: PlayerEventService,
  ) {}

  private async loadOwnedPart(playerId: string, partInstanceId: string) {
    const part = await this.prisma.partInstance.findUnique({
      where: { id: partInstanceId },
      include: { partCatalog: true },
    });
    if (!part || part.ownerPlayerId !== playerId) {
      throw new NotFoundException('part not found');
    }
    return part;
  }

  // A loose inventory part isn't tied to any hull, so — same reasoning as selling it
  // (market.service.ts) — it can be upgraded wherever the player is. An installed part follows
  // its own ship: mid-flight or out of port, the workshop cannot touch it.
  private async assertPortReady(part: { location: string; shipId: string | null }): Promise<void> {
    if (part.location !== 'INSTALLED' || part.shipId === null) return;
    const ship = await this.prisma.ship.findUnique({
      where: { id: part.shipId },
      select: { status: true },
    });
    if (!ship) throw new NotFoundException('ship not found');
    if (ship.status === 'ON_MISSION') throw new ConflictException({ error: 'SHIP_ON_MISSION' });
    if (ship.status !== 'IN_PORT') throw new ConflictException({ error: 'SHIP_NOT_IN_PORT' });
  }

  private async plan(playerId: string, partInstanceId: string) {
    const part = await this.loadOwnedPart(playerId, partInstanceId);
    const nextPartType = nextTierPartTypeOf(part.partType, part.partCatalog.rarity);
    if (nextPartType === null) {
      return { part, eligible: false as const, reason: 'MAX_TIER' as const };
    }
    const nextCatalog = await this.prisma.partCatalog.findUnique({
      where: { partType: nextPartType },
    });
    if (!nextCatalog || !nextCatalog.active) {
      return { part, eligible: false as const, reason: 'NO_NEXT_TIER' as const };
    }
    // An upgrade is rarity and stats, never a different footprint: a part that grows would no
    // longer fit where it sits. The catalog must keep every tier of a family the same size.
    if (nextCatalog.w !== part.partCatalog.w || nextCatalog.h !== part.partCatalog.h) {
      return { part, eligible: false as const, reason: 'NO_NEXT_TIER' as const };
    }
    // Owner request (round 7): only a fully-repaired part can be upgraded — an upgrade changes
    // what the part IS, not its wear, so a damaged one has to be repaired first regardless of
    // whether the player could otherwise afford both at once.
    if (part.condition < FULL_CONDITION) {
      return { part, eligible: false as const, reason: 'NOT_FULL_CONDITION' as const };
    }
    const multiplierByRarity = this.config.snapshot().rules.economy.part_upgrade_price_multiplier;
    const multiplier = multiplierByRarity[part.partCatalog.rarity] ?? 1;
    const cost = partUpgradeCost(part.partCatalog.basePrice, nextCatalog.basePrice, multiplier);
    const needs = upgradeNeeds(
      part.partCatalog.rarity,
      nextCatalog.basePrice - part.partCatalog.basePrice,
      part.partCatalog.w * part.partCatalog.h,
      this.config.snapshot().rules,
    );
    return { part, eligible: true as const, nextCatalog, cost, needs };
  }

  /** What the pilot holds of each needed material ('scrap' adds up every scrap material). */
  private async materialsFor(
    client: Pick<PrismaService, 'playerMaterial' | 'material'>,
    playerId: string,
    needs: ReadonlyArray<{ material: string; quantity: number }>,
  ): Promise<PartUpgradeMaterial[]> {
    const held = await client.playerMaterial.findMany({
      where: { playerId, quantity: { gt: 0 } },
      select: { materialId: true, quantity: true },
    });
    const ids = needs.map((need) => need.material).filter((id) => id !== SCRAP);
    const rows = await client.material.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true },
    });
    const names = new Map(rows.map((row) => [row.id, bilingual(row.displayName)]));
    return needs.map((need) => ({
      materialId: need.material,
      displayName:
        need.material === SCRAP
          ? { en: 'Scrap (any part)', 'pt-BR': 'Sucata (qualquer peça)' }
          : (names.get(need.material) ?? { en: need.material, 'pt-BR': need.material }),
      needed: need.quantity,
      have: held
        .filter((entry) =>
          need.material === SCRAP
            ? entry.materialId.startsWith(SCRAP_PREFIX)
            : entry.materialId === need.material,
        )
        .reduce((sum, entry) => sum + entry.quantity, 0),
    }));
  }

  /** Takes the needed units out of the pilot's goods: scrap from the least valuable scrap first. */
  private async consume(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    playerId: string,
    needs: ReadonlyArray<{ material: string; quantity: number }>,
  ): Promise<void> {
    for (const need of needs) {
      let left = need.quantity;
      const rows = await tx.playerMaterial.findMany({
        where: {
          playerId,
          quantity: { gt: 0 },
          ...(need.material === SCRAP
            ? { materialId: { startsWith: SCRAP_PREFIX } }
            : { materialId: need.material }),
        },
        include: { material: { select: { basePrice: true } } },
        orderBy: [{ material: { basePrice: 'asc' } }, { materialId: 'asc' }],
      });
      for (const row of rows) {
        if (left <= 0) break;
        const take = Math.min(left, row.quantity);
        await tx.playerMaterial.update({
          where: { playerId_materialId: { playerId, materialId: row.materialId } },
          data: { quantity: { decrement: take } },
        });
        left -= take;
      }
      if (left > 0) {
        throw new ConflictException({ error: 'INSUFFICIENT_MATERIALS' });
      }
    }
  }

  async quote(playerId: string, partInstanceId: string): Promise<PartUpgradeQuote> {
    const outcome = await this.plan(playerId, partInstanceId);
    if (!outcome.eligible) {
      return { partInstanceId, eligible: false, reason: outcome.reason };
    }
    return {
      partInstanceId,
      eligible: true,
      nextPartType: outcome.nextCatalog.partType,
      nextDisplayName: bilingual(outcome.nextCatalog.displayName),
      cost: outcome.cost,
      materials: await this.materialsFor(this.prisma, playerId, outcome.needs),
      nextRarity: outcome.nextCatalog.rarity,
      nextDescription: bilingual(outcome.nextCatalog.description),
      nextCatalog: pickCatalogStats(outcome.nextCatalog),
    };
  }

  async upgrade(playerId: string, partInstanceId: string): Promise<PartUpgradeResult> {
    // Ship/port state is checked first: it's the more fundamental gate ("you can't touch this
    // part at all right now"), so it should never be masked by a part-level reason like
    // NOT_FULL_CONDITION when both happen to be true at once.
    const part = await this.loadOwnedPart(playerId, partInstanceId);
    await this.assertPortReady(part);
    const outcome = await this.plan(playerId, partInstanceId);
    if (!outcome.eligible) {
      throw new ConflictException({ error: outcome.reason });
    }
    const { nextCatalog, cost, needs } = outcome;

    const updated = await this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "PartInstance" WHERE id = ${partInstanceId} FOR UPDATE`;
        const locked = await tx.partInstance.findUniqueOrThrow({ where: { id: partInstanceId } });
        if (locked.ownerPlayerId !== playerId) throw new NotFoundException('part not found');
        const player = await tx.player.findUnique({
          where: { id: playerId },
          select: { credits: true },
        });
        if (player && player.credits < 0)
          throw new ConflictException({ error: 'BALANCE_NEGATIVE' });
        const held = await this.materialsFor(tx, playerId, needs);
        if (held.some((entry) => entry.have < entry.needed)) {
          throw new ConflictException({
            error: 'INSUFFICIENT_MATERIALS',
            materials: held.map((entry) => ({
              materialId: entry.materialId,
              needed: entry.needed,
              have: entry.have,
            })),
          });
        }
        await this.wallet.debit(playerId, cost, `part.upgrade:${partInstanceId}`, tx);
        await this.consume(tx, playerId, needs);
        const next = await tx.partInstance.update({
          where: { id: partInstanceId },
          data: { partType: nextCatalog.partType },
          include: { partCatalog: true },
        });
        await this.events.record(
          {
            playerId,
            type: PART_UPGRADED_EVENT,
            payload: {
              partInstanceId,
              fromPartType: locked.partType,
              toPartType: nextCatalog.partType,
              cost,
              materials: needs.map((need) => ({
                material: need.material,
                quantity: need.quantity,
              })),
            },
          },
          tx,
        );
        return next;
      })
      .catch((error: unknown) => {
        if (error instanceof InsufficientFundsError) {
          throw new ConflictException({ error: 'INSUFFICIENT_FUNDS' });
        }
        throw error;
      });

    const player = await this.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { credits: true },
    });
    return {
      partInstanceId,
      partType: updated.partType,
      displayName: bilingual(updated.partCatalog.displayName),
      rarity: updated.partCatalog.rarity,
      condition: updated.condition,
      cost,
      credits: player.credits,
    };
  }
}
