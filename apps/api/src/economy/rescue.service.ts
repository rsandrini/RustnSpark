import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Clock } from '../common/clock/clock.js';
import { jobDelayMs } from '../config/debug-timing.js';
import type { GameRules } from '../config/game-config.types.js';
import { ShipsService } from '../ships/ships.service.js';
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { WalletService } from '../players/wallet.service.js';
import { InventoryService, type ViabilityReport } from './inventory.service.js';

export const RESCUE_EVENT = 'rescue';

const ZERO = 0;

export interface RescueResponse {
  readonly shipId: string;
  /** IN_PORT once towed; ADRIFT while a waiting rescue is on its way. */
  readonly status: string;
  readonly mode: RescueMode;
  readonly cost: number;
  readonly fuel: number;
  readonly credits: number;
  readonly restartParts: string[];
  readonly viability: ViabilityReport;
  /** The base the ship was towed to (or will be). */
  readonly baseId: string;
  /** When the waiting rescue arrives; null once towed. */
  readonly dueAt: string | null;
}

export type RescueMode = 'now' | 'wait';

const MS_PER_SECOND = 1000;

/**
 * S8.6: rescue of a floating ship (GDD §14). The ship floats where it ran dry, on a route. Two ways
 * out, both end with a tow to the nearest base and a debit that may drive the balance negative
 * (`debitAllowingNegative` — repairs and refuel are then gated by the spending guard, navigation
 * and scavenging are not):
 *  - `now`: pay the waiting price plus a charge for the distance to that base, towed at once;
 *  - `wait`: nothing is paid yet; after `economy.rescue_wait_seconds` the rescue arrives and the
 *    (cheaper) waiting price is charged. The arrival is settled when someone looks (`settle`).
 * Fuel is not refilled beyond a small emergency ration (`economy.rescue_fuel_fraction` of the
 * tank), so a rescue is not a real fuel source. Finally the hull is brought back to viability by
 * the restart kit when its build no longer holds.
 */
@Injectable()
export class RescueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly wallet: WalletService,
    private readonly events: PlayerEventService,
    private readonly inventory: InventoryService,
    private readonly ships: ShipsService,
    private readonly clock: Clock,
  ) {}

  /** Calls the rescue: `now` tows at once; `wait` starts the timer (and keeps it if already running). */
  async rescue(shipId: string, playerId: string, mode: RescueMode): Promise<RescueResponse> {
    const rules = this.config.snapshot().rules;
    const now = this.clock.now();

    const outcome = await this.prisma.$transaction(async (tx) => {
      const ship = await this.lockAdriftShip(tx, shipId, playerId);
      const { rescue, plan } = await this.ships.adriftOf(ship, rules);

      if (mode === 'wait') {
        const delay = await this.waitMs(tx, playerId, rules);
        const dueAt = ship.rescueAt ?? new Date(now.getTime() + delay);
        if (ship.rescueAt === null) {
          await tx.ship.update({ where: { id: shipId }, data: { rescueAt: dueAt } });
        }
        return { towed: null, dueAt, baseId: plan.baseId, cost: 0 };
      }

      const towed = await this.tow(tx, shipId, playerId, plan.baseId, rescue.nowCost, 'now');
      return { towed, dueAt: null, baseId: plan.baseId, cost: rescue.nowCost };
    });

    return this.respond(shipId, playerId, mode, outcome);
  }

  /** Lets a waiting rescue arrive once its time is up (a no-op answer 409 before that). */
  async settle(shipId: string, playerId: string): Promise<RescueResponse> {
    const rules = this.config.snapshot().rules;
    const now = this.clock.now();

    const outcome = await this.prisma.$transaction(async (tx) => {
      const ship = await this.lockAdriftShip(tx, shipId, playerId);
      if (ship.rescueAt === null || ship.rescueAt.getTime() > now.getTime()) {
        throw new ConflictException({ error: 'RESCUE_NOT_DUE' });
      }
      const { rescue, plan } = await this.ships.adriftOf(ship, rules);
      const towed = await this.tow(tx, shipId, playerId, plan.baseId, rescue.waitCost, 'wait');
      return { towed, dueAt: null, baseId: plan.baseId, cost: rescue.waitCost };
    });

    return this.respond(shipId, playerId, 'wait', outcome);
  }

  private async lockAdriftShip(tx: Prisma.TransactionClient, shipId: string, playerId: string) {
    // Same lock discipline as dispatch/refuel/repair: a peer flipping the ship between read and
    // write must not rescue it twice or while it is underway.
    await tx.$queryRaw`SELECT id FROM "Ship" WHERE id = ${shipId} FOR UPDATE`;
    const ship = await tx.ship.findFirst({ where: { id: shipId, ownerPlayerId: playerId } });
    if (!ship) {
      throw new NotFoundException('ship not found');
    }
    if (ship.status === 'ON_MISSION') {
      throw new ConflictException({ error: 'SHIP_ON_MISSION' });
    }
    if (ship.status !== 'ADRIFT') {
      throw new ConflictException({ error: 'SHIP_NOT_ADRIFT' });
    }
    return ship;
  }

  /** The delay before a waiting rescue arrives (a debug account gets the short one). */
  private async waitMs(tx: Prisma.TransactionClient, playerId: string, rules: GameRules): Promise<number> {
    const player = await tx.player.findUnique({
      where: { id: playerId },
      select: { debugFastOps: true },
    });
    return jobDelayMs(
      rules.economy.rescue_wait_seconds * MS_PER_SECOND,
      rules,
      player?.debugFastOps ?? false,
    );
  }

  /** Charges the rescue, tows the ship to `baseId` and leaves it in port with its emergency ration. */
  private async tow(
    tx: Prisma.TransactionClient,
    shipId: string,
    playerId: string,
    baseId: string,
    cost: number,
    mode: RescueMode,
  ) {
    const rules = this.config.snapshot().rules;
    if (cost > ZERO) {
      await this.wallet.debitAllowingNegative(playerId, cost, `${RESCUE_EVENT}:${shipId}`, tx);
    }
    await tx.ship.update({
      where: { id: shipId },
      data: {
        status: 'IN_PORT',
        currentLocationId: baseId,
        floatRouteId: null,
        floatFromId: null,
        floatProgress: null,
        rescueAt: null,
      },
    });
    const restart = await this.inventory.ensureViableShip(tx, playerId, shipId);
    // Emergency ration (economy.rescue_fuel_fraction): never lowers fuel, never passes the tank.
    // Rescue stays a poor fuel source, but a broke player can still fly one short job.
    const ration = Math.round(restart.fuelCap * rules.economy.rescue_fuel_fraction);
    const held = await tx.ship.findUniqueOrThrow({ where: { id: shipId }, select: { fuel: true } });
    const fuel = Math.min(restart.fuelCap, Math.max(held.fuel, ration));
    if (fuel !== held.fuel) {
      await tx.ship.update({ where: { id: shipId }, data: { fuel } });
    }
    await this.events.record(
      {
        playerId,
        type: RESCUE_EVENT,
        payload: { shipId, cost, fuel, mode, baseId, restartParts: restart.restartParts },
      },
      tx,
    );
    return { ...restart, fuel };
  }

  private async respond(
    shipId: string,
    playerId: string,
    mode: RescueMode,
    outcome: {
      towed: Awaited<ReturnType<RescueService['tow']>> | null;
      dueAt: Date | null;
      baseId: string;
      cost: number;
    },
  ): Promise<RescueResponse> {
    const credits = await this.creditsOf(playerId);
    if (outcome.towed === null) {
      const ship = await this.prisma.ship.findUniqueOrThrow({
        where: { id: shipId },
        select: { fuel: true },
      });
      return {
        shipId,
        status: 'ADRIFT',
        mode,
        cost: 0,
        fuel: ship.fuel,
        credits,
        restartParts: [],
        // Nothing changed on the ship yet: the viability is reported when the tow happens.
        viability: { viable: true, problems: [] },
        baseId: outcome.baseId,
        dueAt: outcome.dueAt?.toISOString() ?? null,
      };
    }
    return {
      shipId,
      status: 'IN_PORT',
      mode,
      cost: outcome.cost,
      fuel: outcome.towed.fuel,
      credits,
      restartParts: outcome.towed.restartParts,
      viability: outcome.towed.viability,
      baseId: outcome.baseId,
      dueAt: null,
    };
  }

  private async creditsOf(playerId: string): Promise<number> {
    const player = await this.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { credits: true },
    });
    return player.credits;
  }
}
