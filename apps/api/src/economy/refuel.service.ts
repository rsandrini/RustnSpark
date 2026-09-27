import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GameConfigService } from '../config/game-config.service.js';
import type { GameRules } from '../config/game-config.types.js';
import { PartsService, pickCatalogStats } from '../parts/parts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { InsufficientFundsError, WalletService } from '../players/wallet.service.js';
import { deriveSheet } from '../ships/sheet.deriver.js';
import { refuelCost } from './fuel-cost.calculator.js';
import { PricingService } from './pricing.service.js';

export const REFUEL_EVENT = 'refuel';

const ZERO = 0;

export type RefuelMode = 'full' | 'partial';

export interface RefuelResponse {
  readonly shipId: string;
  readonly units: number;
  readonly cost: number;
  readonly fuel: number;
  readonly fuelCap: number;
  readonly credits: number;
}

function assertRefuelable(status: string): void {
  if (status === 'ON_MISSION') {
    throw new ConflictException({ error: 'SHIP_ON_MISSION' });
  }
  if (status !== 'IN_PORT') {
    throw new ConflictException({ error: 'SHIP_NOT_IN_PORT' });
  }
}

/**
 * S8.3: instant refuel (GDD §16 "paga e sai"). Units are capped by the tank
 * (`fuelCap` from the derived sheet), priced with `refuelCost`
 * (`fuel_price × isolation × faction`, plan S5.8 location factor — no mood),
 * and debited atomically with the fuel update under a Ship row lock so a
 * concurrent dispatch can never double-spend. Fuel is prepaid inventory:
 * missions burn tank units and never charge credits again.
 */
@Injectable()
export class RefuelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly parts: PartsService,
    private readonly pricing: PricingService,
    private readonly wallet: WalletService,
    private readonly events: PlayerEventService,
  ) {}

  async refuel(
    shipId: string,
    playerId: string,
    mode: RefuelMode,
    amount?: number,
  ): Promise<RefuelResponse> {
    const ship = await this.prisma.ship.findFirst({
      where: { id: shipId, ownerPlayerId: playerId },
      select: { id: true, status: true, currentLocationId: true, fuel: true },
    });
    if (!ship) {
      throw new NotFoundException('ship not found');
    }
    assertRefuelable(ship.status);

    // "full" ignores any amount; "partial" must name how many units to buy.
    if (
      mode === 'partial' &&
      !(typeof amount === 'number' && Number.isFinite(amount) && amount > ZERO)
    ) {
      throw new BadRequestException({ error: 'INVALID_AMOUNT' });
    }

    const rules = this.config.snapshot().rules;
    const context = await this.pricing.contextForLocation(ship.currentLocationId, playerId);
    const fuelCap = await this.fuelCapOf(playerId, shipId, rules);
    const tankNeed = Math.max(ZERO, fuelCap - ship.fuel);
    const requested = mode === 'full' ? tankNeed : Math.min(amount ?? ZERO, tankNeed);

    const outcome = await this.prisma
      .$transaction(async (tx) => {
        // Same lock discipline as dispatch/repair: a peer that flips the ship to
        // ON_MISSION right after our read must not be refueled past this point.
        await tx.$queryRaw`SELECT id FROM "Ship" WHERE id = ${shipId} FOR UPDATE`;
        const locked = await tx.ship.findUniqueOrThrow({
          where: { id: shipId },
          select: { status: true, fuel: true },
        });
        assertRefuelable(locked.status);
        const player = await tx.player.findUnique({
          where: { id: playerId },
          select: { credits: true },
        });
        if (player && player.credits < 0) {
          throw new ConflictException({ error: 'BALANCE_NEGATIVE' });
        }

        // Re-derive against the locked fuel: a concurrent refuel may have
        // already filled part of the gap (capped by tank, never over).
        const units = Math.min(requested, Math.max(ZERO, fuelCap - locked.fuel));
        if (units <= ZERO) {
          return { units: ZERO, cost: ZERO, fuel: locked.fuel };
        }

        const rawCost = refuelCost(
          units,
          context.location.isolation,
          context.factionRelation,
          rules,
        );
        // Wallet amounts are whole credits; a positive purchase never rounds to free.
        const cost = Math.max(1, Math.round(rawCost));
        await this.wallet.debit(playerId, cost, `${REFUEL_EVENT}:${shipId}`, tx);
        const fuel = Math.min(fuelCap, locked.fuel + units);
        await tx.ship.update({ where: { id: shipId }, data: { fuel } });
        await this.events.record(
          { playerId, type: REFUEL_EVENT, payload: { shipId, units, cost, fuelCap } },
          tx,
        );
        return { units, cost, fuel };
      })
      .catch((error: unknown) => {
        if (error instanceof InsufficientFundsError) {
          throw new ConflictException({ error: 'INSUFFICIENT_FUNDS' });
        }
        throw error;
      });

    const credits = await this.creditsOf(playerId);
    return {
      shipId,
      units: outcome.units,
      cost: outcome.cost,
      fuel: outcome.fuel,
      fuelCap,
      credits,
    };
  }

  /**
   * What a refuel would buy and cost, without touching the wallet: the screen's slider asks this
   * for each amount, and start (`refuel`) prices with the very same functions.
   */
  async quote(shipId: string, playerId: string, mode: RefuelMode, amount?: number) {
    const ship = await this.prisma.ship.findFirst({
      where: { id: shipId, ownerPlayerId: playerId },
      select: { id: true, status: true, currentLocationId: true, fuel: true },
    });
    if (!ship) {
      throw new NotFoundException('ship not found');
    }
    assertRefuelable(ship.status);
    if (
      mode === 'partial' &&
      !(typeof amount === 'number' && Number.isFinite(amount) && amount > ZERO)
    ) {
      throw new BadRequestException({ error: 'INVALID_AMOUNT' });
    }
    const rules = this.config.snapshot().rules;
    const context = await this.pricing.contextForLocation(ship.currentLocationId, playerId);
    const fuelCap = await this.fuelCapOf(playerId, shipId, rules);
    const space = Math.max(ZERO, fuelCap - ship.fuel);
    const units = mode === 'full' ? space : Math.min(amount ?? ZERO, space);
    const cost =
      units <= ZERO
        ? ZERO
        : Math.max(
            1,
            Math.round(
              refuelCost(units, context.location.isolation, context.factionRelation, rules),
            ),
          );
    // What one unit costs here (before whole-credit rounding): the screen prices its slider with
    // it, so dragging never waits on the server. `cost` for `units` is max(1, round(units × unitPrice)).
    const unitPrice = refuelCost(1, context.location.isolation, context.factionRelation, rules);
    return { shipId, units, cost, unitPrice, fuel: ship.fuel, fuelCap, space };
  }

  // fuelCap is derived from installed parts (sum of `fuelCap` stats), so it is
  // recomputed per call — refitting the tank mid-session changes the ceiling.
  private async fuelCapOf(playerId: string, shipId: string, rules: GameRules): Promise<number> {
    const rows = await this.parts.findPlayerParts(playerId);
    const installed = rows
      .filter((row) => row.location === 'INSTALLED' && row.shipId === shipId)
      .map((row) => ({ instance: row, catalog: pickCatalogStats(row.partCatalog) }));
    return deriveSheet(installed, rules).fuelCap;
  }

  private async creditsOf(playerId: string): Promise<number> {
    const player = await this.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { credits: true },
    });
    return player.credits;
  }
}
