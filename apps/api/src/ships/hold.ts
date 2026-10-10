import type { Prisma } from '@prisma/client';
import type { ViabilityReport } from './viability.js';

/**
 * What the ship carries besides its installed parts.
 * - Spare parts: the bridge carries a number of loose parts for free, one slot per part whatever its
 *   size or rarity (`ship.spare_part_slots`). More than that and the ship cannot depart.
 * - Cargo space: every unit of ore or scrap held takes one, and so does the cargo a mission has the
 *   ship carry (a fixed load, or an open one filling what is left).
 */
export interface HoldState {
  /** Loose parts the bridge carries for free. */
  readonly slots: number;
  /** Loose parts held. */
  readonly parts: number;
  /** Units of ore and scrap held. */
  readonly ore: number;
  /** Cargo the mission puts aboard (0 outside a mission with a load). */
  readonly missionCargo: number;
  /** The ship's cargo space. */
  readonly capacity: number;
  /** Cargo space taken: the ore and the mission's cargo. */
  readonly used: number;
  readonly free: number;
  /** More loose parts than the bridge has slots for. */
  readonly partsOver: boolean;
  /** Ore and mission cargo do not fit the cargo space. */
  readonly cargoOver: boolean;
  readonly over: boolean;
}

export function computeHold(input: {
  readonly slots: number;
  readonly parts: number;
  readonly ore: number;
  readonly capacity: number;
  readonly missionCargo?: number;
}): HoldState {
  const missionCargo = input.missionCargo ?? 0;
  const used = input.ore + missionCargo;
  const partsOver = input.parts > input.slots;
  const cargoOver = used > input.capacity;
  return {
    slots: input.slots,
    parts: input.parts,
    ore: input.ore,
    missionCargo,
    capacity: input.capacity,
    used,
    free: Math.max(0, input.capacity - used),
    partsOver,
    cargoOver,
    over: partsOver || cargoOver,
  };
}

/** Reads the player's loose parts and held materials and measures them against the ship. */
export async function loadHold(
  prisma: Pick<Prisma.TransactionClient, 'partInstance' | 'playerMaterial'>,
  playerId: string,
  slots: number,
  capacity: number,
  missionCargo = 0,
): Promise<HoldState> {
  const [parts, held] = await Promise.all([
    prisma.partInstance.count({ where: { ownerPlayerId: playerId, location: 'INVENTORY' } }),
    prisma.playerMaterial.aggregate({ where: { playerId }, _sum: { quantity: true } }),
  ]);
  return computeHold({ slots, parts, ore: held._sum.quantity ?? 0, capacity, missionCargo });
}

/** The viability report with the hold problems added when the load does not fit. */
export function withHoldProblem(report: ViabilityReport, hold: HoldState): ViabilityReport {
  if (!hold.over) return report;
  const problems = [...report.problems];
  if (hold.partsOver) {
    problems.push({
      code: 'HOLD_PARTS_OVER',
      message: `Too many spare parts: ${hold.parts} held, the bridge carries ${hold.slots}.`,
    });
  }
  if (hold.cargoOver) {
    problems.push({
      code: 'HOLD_OVER_CAPACITY',
      message: `The load does not fit: ${hold.used} cargo space needed for the ore and the mission's cargo, ${hold.capacity} available.`,
    });
  }
  return { ...report, viable: false, problems };
}
