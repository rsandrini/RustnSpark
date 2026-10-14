import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, Rarity } from '@prisma/client';
import { GameConfigService } from '../config/game-config.service.js';
import { toJsonInput } from '../common/prisma-json.js';
import { bilingual } from '../parts/parts.service.js';
import { rollConnectorsForPartType } from '../parts/roll-connectors-for-part-type.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { InsufficientFundsError, WalletService } from '../players/wallet.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PricingService } from './pricing.service.js';

export const BRIDGE_EXPANDED_EVENT = 'bridge.expanded';
export const BRIDGE_SHRUNK_EVENT = 'bridge.shrunk';

const RARITY_ORDER: readonly string[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];
const FULL_CONDITION = 100;
const SMALL_BRIDGE_SIZE = 1;
const BIG_BRIDGE_SIZE = 2;

export type BridgeResizeAction = 'expand' | 'shrink';
export type BridgeResizeReason =
  | 'NOT_A_BRIDGE'
  | 'NOT_EXPANDABLE'
  | 'NOT_SHRINKABLE'
  | 'RARITY_TOO_LOW'
  | 'NO_TARGET'
  | 'TOO_DAMAGED_TO_SELL'
  | 'FORMAT_REQUIRES_BRIDGE';

export interface BridgeResizeQuote {
  readonly partInstanceId: string;
  readonly action: BridgeResizeAction;
  readonly eligible: boolean;
  readonly reason?: BridgeResizeReason;
  readonly targetPartType?: string;
  readonly targetDisplayName?: { en: string; 'pt-BR': string };
  readonly targetRarity?: string;
  /** Expand: the full price of the target bridge. Shrink: the price of the new, smaller bridge. */
  readonly cost?: number;
  /** Shrink only: what the port pays for the bridge being handed in. */
  readonly credit?: number;
}

export interface BridgeResizeResult {
  readonly action: BridgeResizeAction;
  /** The consumed (expand) or sold (shrink) bridge. */
  readonly removedPartInstanceId: string;
  /** The new bridge, loose in the inventory: the pilot installs it. */
  readonly partInstanceId: string;
  readonly partType: string;
  readonly displayName: { en: string; 'pt-BR': string };
  readonly rarity: string;
  readonly condition: number;
  /** Money out (expand) or net money change as a signed delta (shrink: credit - cost). */
  readonly cost: number;
  readonly credits: number;
}

type Tx = Prisma.TransactionClient;

/**
 * Changing a bridge's size. A bridge cannot be upgraded across sizes (the upgrade keeps the
 * footprint), so a size change is its own operation, done in a port:
 *
 *  - Expand: a 1x1 becomes the 2x2 one rarity level BELOW it. The full price of the 2x2 is paid in
 *    money, nothing is credited for the old bridge, which is consumed.
 *  - Shrink: a 2x2 becomes the 1x1 of the SAME rarity: the 2x2 is sold at the port's sell price
 *    and the 1x1 bought at its catalog price. Because Expand never discounts and Shrink goes
 *    through the normal sell price (sell ratio, condition), an Expand -> Shrink loop always loses
 *    money.
 *
 * Either way the new bridge lands loose in the inventory at full condition, and the ship is left
 * without a bridge until the pilot installs it.
 */
@Injectable()
export class BridgeResizeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly wallet: WalletService,
    private readonly events: PlayerEventService,
    private readonly pricing: PricingService,
  ) {}

  private async loadOwnedPart(
    playerId: string,
    partInstanceId: string,
    client: Tx | PrismaService,
  ) {
    const part = await client.partInstance.findUnique({
      where: { id: partInstanceId },
      include: { partCatalog: true },
    });
    if (!part || part.ownerPlayerId !== playerId) throw new NotFoundException('part not found');
    return part;
  }

  /** A size change is a port action: the pilot's ship must be docked. */
  private async assertInPort(playerId: string) {
    const ship = await this.prisma.ship.findFirst({
      where: { ownerPlayerId: playerId },
      orderBy: { id: 'asc' },
      select: { id: true, status: true, currentLocationId: true },
    });
    if (!ship) throw new NotFoundException('player has no ship');
    if (ship.status === 'ON_MISSION') throw new ConflictException({ error: 'SHIP_ON_MISSION' });
    if (ship.status !== 'IN_PORT') throw new ConflictException({ error: 'SHIP_NOT_IN_PORT' });
    return ship;
  }

  private async plan(
    client: Tx | PrismaService,
    part: Awaited<ReturnType<BridgeResizeService['loadOwnedPart']>>,
    action: BridgeResizeAction,
  ) {
    const fail = (reason: BridgeResizeReason) => ({ eligible: false as const, reason });
    const catalog = part.partCatalog;
    if (catalog.partClass !== 'BRIDGE') return fail('NOT_A_BRIDGE');
    const index = RARITY_ORDER.indexOf(catalog.rarity);
    let targetRarity: Rarity = catalog.rarity;
    let size = SMALL_BRIDGE_SIZE;
    if (action === 'expand') {
      if (catalog.w !== SMALL_BRIDGE_SIZE || catalog.h !== SMALL_BRIDGE_SIZE)
        return fail('NOT_EXPANDABLE');
      if (index <= 0) return fail('RARITY_TOO_LOW');
      targetRarity = RARITY_ORDER[index - 1]! as Rarity;
      size = BIG_BRIDGE_SIZE;
    } else {
      if (catalog.w !== BIG_BRIDGE_SIZE || catalog.h !== BIG_BRIDGE_SIZE)
        return fail('NOT_SHRINKABLE');
      if (part.condition < this.config.snapshot().rules.economy.sell_min_condition) {
        return fail('TOO_DAMAGED_TO_SELL');
      }
      if (part.location === 'INSTALLED' && part.shipId !== null) {
        const ship = await client.ship.findUnique({
          where: { id: part.shipId },
          include: { format: { select: { minBridgeSize: true } } },
        });
        // Shrinking the bridge a big format stands on would strand the ship on that format.
        if (ship !== null && ship.format.minBridgeSize > SMALL_BRIDGE_SIZE)
          return fail('FORMAT_REQUIRES_BRIDGE');
      }
    }
    const target = await client.partCatalog.findFirst({
      where: {
        partClass: 'BRIDGE',
        w: size,
        h: size,
        rarity: targetRarity,
        active: true,
      },
      orderBy: { partType: 'asc' },
    });
    if (target === null) return fail('NO_TARGET');
    return { eligible: true as const, target };
  }

  async quote(
    playerId: string,
    partInstanceId: string,
    action: BridgeResizeAction,
  ): Promise<BridgeResizeQuote> {
    const part = await this.loadOwnedPart(playerId, partInstanceId, this.prisma);
    const outcome = await this.plan(this.prisma, part, action);
    if (!outcome.eligible) {
      return { partInstanceId, action, eligible: false, reason: outcome.reason };
    }
    const { target } = outcome;
    const base: BridgeResizeQuote = {
      partInstanceId,
      action,
      eligible: true,
      targetPartType: target.partType,
      targetDisplayName: bilingual(target.displayName),
      targetRarity: target.rarity,
      cost: target.basePrice,
    };
    if (action === 'expand') return base;
    const context = await this.pricing.contextForPlayer(playerId);
    return {
      ...base,
      credit: this.pricing.sell(context, part, { basePrice: part.partCatalog.basePrice }),
    };
  }

  async resize(
    playerId: string,
    partInstanceId: string,
    action: BridgeResizeAction,
  ): Promise<BridgeResizeResult> {
    const preflight = await this.loadOwnedPart(playerId, partInstanceId, this.prisma);
    const ship = await this.assertInPort(playerId);
    const context =
      action === 'shrink'
        ? await this.pricing.contextForLocation(ship.currentLocationId, playerId)
        : null;

    try {
      const outcome = await this.prisma.$transaction(async (tx) => {
        // Lock order everywhere: the Ship row, then the part row.
        if (preflight.location === 'INSTALLED' && preflight.shipId !== null) {
          await tx.$queryRaw`SELECT id FROM "Ship" WHERE id = ${preflight.shipId} FOR UPDATE`;
        }
        await tx.$queryRaw`SELECT id FROM "PartInstance" WHERE id = ${partInstanceId} FOR UPDATE`;
        const part = await this.loadOwnedPart(playerId, partInstanceId, tx);
        const planned = await this.plan(tx, part, action);
        if (!planned.eligible) throw new ConflictException({ error: planned.reason });
        const { target } = planned;

        const player = await tx.player.findUnique({
          where: { id: playerId },
          select: { credits: true },
        });
        if (player && player.credits < 0)
          throw new ConflictException({ error: 'BALANCE_NEGATIVE' });

        let credit = 0;
        if (action === 'shrink' && context !== null) {
          credit = this.pricing.sell(context, part, { basePrice: part.partCatalog.basePrice });
        }
        // One money movement: expand pays the target's full price; shrink settles the sale of
        // the old bridge against the price of the new one.
        const delta = credit - target.basePrice;
        const reason = `bridge.${action}:${partInstanceId}`;
        if (delta < 0) await this.wallet.debit(playerId, -delta, reason, tx);
        else if (delta > 0) await this.wallet.credit(playerId, delta, reason, tx);

        if (part.location === 'INSTALLED' && part.shipId !== null) {
          const hull = await tx.ship.findUnique({ where: { id: part.shipId } });
          if (hull?.status === 'ON_MISSION') {
            throw new ConflictException({ error: 'SHIP_ON_MISSION' });
          }
          if (hull !== null) {
            const layout = Array.isArray(hull.layout)
              ? (hull.layout as Array<{ partInstanceId?: string }>)
              : [];
            await tx.ship.update({
              where: { id: hull.id },
              data: {
                layout: toJsonInput(
                  layout.filter((placement) => placement.partInstanceId !== part.id),
                ),
              },
            });
          }
        }
        await tx.partInstance.delete({ where: { id: part.id } });
        const created = await tx.partInstance.create({
          data: {
            partType: target.partType,
            ownerPlayerId: playerId,
            condition: FULL_CONDITION,
            location: 'INVENTORY',
            connectors: toJsonInput(await rollConnectorsForPartType(tx, target.partType)),
          },
          include: { partCatalog: true },
        });
        await this.events.record(
          {
            playerId,
            type: action === 'expand' ? BRIDGE_EXPANDED_EVENT : BRIDGE_SHRUNK_EVENT,
            payload: {
              fromPartType: part.partType,
              toPartType: target.partType,
              removedPartInstanceId: part.id,
              partInstanceId: created.id,
              price: target.basePrice,
              credit,
            },
          },
          tx,
        );
        const after = await tx.player.findUniqueOrThrow({
          where: { id: playerId },
          select: { credits: true },
        });
        return { created, removed: part.id, delta, credits: after.credits };
      });
      return {
        action,
        removedPartInstanceId: outcome.removed,
        partInstanceId: outcome.created.id,
        partType: outcome.created.partType,
        displayName: bilingual(outcome.created.partCatalog.displayName),
        rarity: outcome.created.partCatalog.rarity,
        condition: outcome.created.condition,
        cost: -outcome.delta,
        credits: outcome.credits,
      };
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new ConflictException({ error: 'INSUFFICIENT_FUNDS' });
      }
      throw error;
    }
  }
}
