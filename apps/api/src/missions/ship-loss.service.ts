import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { toJsonInput } from '../common/prisma-json.js';
import type { GameRules } from '../config/game-rules.schema.js';
import { rollConnectorsForPartType } from '../parts/roll-connectors-for-part-type.js';
import { PlayerEventService } from '../players/player-event.service.js';

export const SHIP_DESTROYED_EVENT = 'ship.destroyed';

const DEFAULT_FORMAT_ID = 'classic_square';
const FULL_ENERGY_MODE = 'FULL';
const NEUTRAL_STANCE = 'NEUTRAL';

export interface ShipLossResult {
  /** Parts (installed and loose) that went down with the ship. */
  readonly lostParts: number;
  /** Where the new ship starts. */
  readonly homeLocationId: string | null;
}

/**
 * A destroyed bridge destroys the ship: every part the pilot owns is lost and the pilot restarts
 * with a new starter pack at the faction's home port. What survives is the money, the goods in
 * storage (materials), the faction and the history. The new kit arrives loose, exactly like the
 * first one, with the tank full.
 *
 * Runs inside the caller's transaction (the mission resolution) so the loss and the mission's
 * outcome are one atomic change.
 */
@Injectable()
export class ShipLossService {
  constructor(private readonly events: PlayerEventService) {}

  async destroy(
    tx: Prisma.TransactionClient,
    args: { playerId: string; shipId: string; missionId: string; rules: GameRules },
  ): Promise<ShipLossResult> {
    const { playerId, shipId, missionId, rules } = args;

    const lost = await tx.partInstance.findMany({
      where: { ownerPlayerId: playerId },
      select: { partType: true },
    });
    await tx.repairJob.deleteMany({ where: { playerId } });
    await tx.partInstance.deleteMany({ where: { ownerPlayerId: playerId } });

    const player = await tx.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { factionId: true },
    });
    const homes = rules.onboarding.home_locations as Record<string, string>;
    const home =
      player.factionId !== null && Object.hasOwn(homes, player.factionId)
        ? (homes[player.factionId] ?? null)
        : null;

    // The new kit: loose parts at the starter condition, then a full tank for what it can hold.
    let fuelCap = 0;
    for (const partType of rules.onboarding.starter_parts as string[]) {
      const created = await tx.partInstance.create({
        data: {
          partType,
          ownerPlayerId: playerId,
          condition: rules.parts.starter_condition,
          location: 'INVENTORY',
          connectors: toJsonInput(await rollConnectorsForPartType(tx, partType, true)),
        },
        include: { partCatalog: { select: { fuelCap: true } } },
      });
      fuelCap += created.partCatalog.fuelCap ?? 0;
    }

    await tx.ship.update({
      where: { id: shipId },
      data: {
        layout: [],
        fuel: fuelCap,
        status: 'IN_PORT',
        stance: NEUTRAL_STANCE,
        energyMode: FULL_ENERGY_MODE,
        chemLevel: 1,
        ionLevel: 1,
        formatId: DEFAULT_FORMAT_ID,
        formatBridgeType: null,
        floatRouteId: null,
        floatFromId: null,
        floatProgress: null,
        rescueAt: null,
        ...(home !== null ? { currentLocationId: home } : {}),
      },
    });

    await this.events.record(
      {
        playerId,
        type: SHIP_DESTROYED_EVENT,
        payload: {
          missionId,
          lostParts: lost.length,
          lostPartTypes: lost.map((part) => part.partType),
          homeLocationId: home,
        },
      },
      tx,
    );
    return { lostParts: lost.length, homeLocationId: home };
  }
}
