import { Injectable, NotFoundException } from '@nestjs/common';
import type { Location, Material, PartCatalog, PartInstance, Player } from '@prisma/client';
import { GameConfigService } from '../config/game-config.service.js';
import type { GameRules } from '../config/game-config.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buyPrice, sellPrice, type PartPriceInput } from './price.calculator.js';

// Catalog listings price a pristine part; materials have no condition at all, so the
// same local-value formula applies at full condition (plan S8.7).
const FULL_CONDITION = 100;

export interface MarketContext {
  readonly location: Location;
  readonly factionRelation: string;
  readonly rules: GameRules;
}

function relationOf(relations: unknown, playerFactionId: string): string {
  let raw: unknown;
  if (typeof relations === 'object' && relations !== null && !Array.isArray(relations)) {
    raw = (relations as Record<string, unknown>)[playerFactionId];
  }
  const normalized = typeof raw === 'string' ? raw.toLowerCase() : 'neutral';
  if (normalized === 'ally' || normalized === 'hostile') return normalized;
  return 'neutral';
}

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
  ) {}

  async contextForLocation(locationId: string, playerId: string): Promise<MarketContext> {
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      include: { faction: { select: { relations: true } } },
    });
    if (!location) throw new NotFoundException('location not found');
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { factionId: true },
    });
    return {
      location,
      factionRelation: relationOf(location.faction.relations, player?.factionId ?? ''),
      rules: this.config.snapshot().rules,
    };
  }

  // Sell/buy without an explicit location uses the player's first ship's port (v0.1:
  // one ship from onboarding; multi-ship trading is out of scope).
  async contextForPlayer(playerId: string): Promise<MarketContext> {
    const ship = await this.prisma.ship.findFirst({
      where: { ownerPlayerId: playerId },
      orderBy: { id: 'asc' },
      select: { currentLocationId: true },
    });
    if (!ship) throw new NotFoundException('player has no ship');
    return this.contextForLocation(ship.currentLocationId, playerId);
  }

  priceInput(
    context: MarketContext,
    catalog: Pick<PartCatalog, 'basePrice'>,
    condition: number,
  ): PartPriceInput {
    return {
      basePrice: catalog.basePrice,
      isolation: context.location.isolation,
      factionRelation: context.factionRelation,
      mood: context.location.mood,
      condition,
    };
  }

  buy(context: MarketContext, catalog: Pick<PartCatalog, 'basePrice'>, condition: number): number {
    return buyPrice(this.priceInput(context, catalog, condition), context.rules);
  }

  sell(
    context: MarketContext,
    part: Pick<PartInstance, 'condition'>,
    catalog: Pick<PartCatalog, 'basePrice'>,
  ): number {
    return sellPrice(this.priceInput(context, catalog, part.condition), context.rules);
  }

  // Plan S8.7: `material.basePrice × isolation × faction × mood × sell_ratio`.
  sellMaterial(context: MarketContext, material: Pick<Material, 'basePrice'>): number {
    return sellPrice(this.priceInput(context, material, FULL_CONDITION), context.rules);
  }

  playerFactionId(playerId: string): Promise<Pick<Player, 'factionId'> | null> {
    return this.prisma.player.findUnique({
      where: { id: playerId },
      select: { factionId: true },
    });
  }
}
