import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { WalletService } from '../players/wallet.service.js';
import { InventoryService, type ViabilityReport } from './inventory.service.js';

export const RESCUE_EVENT = 'rescue';

const ZERO = 0;

export interface RescueResponse {
  readonly shipId: string;
  readonly status: string;
  readonly cost: number;
  readonly credits: number;
  readonly restartParts: string[];
  readonly viability: ViabilityReport;
}

/**
 * S8.6: auto-rescue (GDD §14). A flat `economy.rescue_cost` tow back to IN_PORT that
 * may drive the balance negative (`debitAllowingNegative` — repairs and refuel are then
 * gated by the spending guard, navigation and scavenging are not). The tank is not
 * refilled: rescue is not a fuel source. Finally the hull is brought back to viability
 * by the restart kit when its build no longer holds.
 */
@Injectable()
export class RescueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly wallet: WalletService,
    private readonly events: PlayerEventService,
    private readonly inventory: InventoryService,
  ) {}

  async rescue(shipId: string, playerId: string): Promise<RescueResponse> {
    const cost = this.config.snapshot().rules.economy.rescue_cost;

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Same lock discipline as dispatch/refuel/repair: a peer flipping the ship
      // between read and write must not rescue it twice or while it is underway.
      await tx.$queryRaw`SELECT id FROM "Ship" WHERE id = ${shipId} FOR UPDATE`;
      const ship = await tx.ship.findFirst({
        where: { id: shipId, ownerPlayerId: playerId },
        select: { id: true, status: true },
      });
      if (!ship) {
        throw new NotFoundException('ship not found');
      }
      if (ship.status === 'ON_MISSION') {
        throw new ConflictException({ error: 'SHIP_ON_MISSION' });
      }
      if (ship.status !== 'ADRIFT') {
        throw new ConflictException({ error: 'SHIP_NOT_ADRIFT' });
      }

      if (cost > ZERO) {
        await this.wallet.debitAllowingNegative(playerId, cost, `${RESCUE_EVENT}:${shipId}`, tx);
      }
      // The hull is towed where it stood: currentLocationId and fuel are untouched.
      await tx.ship.update({ where: { id: shipId }, data: { status: 'IN_PORT' } });
      const restart = await this.inventory.ensureViableShip(tx, playerId, shipId);
      await this.events.record(
        {
          playerId,
          type: RESCUE_EVENT,
          payload: { shipId, cost, restartParts: restart.restartParts },
        },
        tx,
      );
      return restart;
    });

    const credits = await this.creditsOf(playerId);
    return {
      shipId,
      status: 'IN_PORT',
      cost,
      credits,
      restartParts: outcome.restartParts,
      viability: outcome.viability,
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
