import type { InstalledPart } from '../parts/part.types.js';
import type { Prisma } from '@prisma/client';
import type { ViabilityReport } from './viability.js';

/**
 * What the ship carries besides its installed parts. The loose parts in the inventory travel with
 * the ship: the bridge gives a number of free slots (cells), what goes past them takes cargo
 * space, and so does every unit of ore or scrap held. A ship whose load does not fit its cargo
 * space cannot depart.
 */
export interface HoldState {
  /** Free cells the bridge gives to loose parts. */
  readonly slots: number;
  /** Cells the loose parts take (width × height each). */
  readonly partCells: number;
  /** Units of ore and scrap held. */
  readonly ore: number;
  /** The ship's cargo space. */
  readonly capacity: number;
  /** Cargo space the load takes: the loose parts past the free slots, plus the ore. */
  readonly used: number;
  readonly free: number;
  readonly over: boolean;
}

export function computeHold(input: {
  readonly slots: number;
  readonly partCells: number;
  readonly ore: number;
  readonly capacity: number;
}): HoldState {
  const used = Math.max(0, input.partCells - input.slots) + input.ore;
  return {
    ...input,
    used,
    free: Math.max(0, input.capacity - used),
    over: used > input.capacity,
  };
}

/** Reads the player's loose parts and held materials and measures them against the ship. */
export async function loadHold(
  prisma: Pick<Prisma.TransactionClient, 'partInstance' | 'playerMaterial'>,
  playerId: string,
  installed: readonly InstalledPart[],
  capacity: number,
): Promise<HoldState> {
  const [loose, held] = await Promise.all([
    prisma.partInstance.findMany({
      where: { ownerPlayerId: playerId, location: 'INVENTORY' },
      select: { partCatalog: { select: { w: true, h: true } } },
    }),
    prisma.playerMaterial.aggregate({ where: { playerId }, _sum: { quantity: true } }),
  ]);
  return computeHold({
    slots: installed.reduce((sum, part) => sum + (part.catalog.storageSlots ?? 0), 0),
    partCells: loose.reduce((sum, part) => sum + part.partCatalog.w * part.partCatalog.h, 0),
    ore: held._sum.quantity ?? 0,
    capacity,
  });
}

/** The viability report with the hold problem added when the load does not fit. */
export function withHoldProblem(report: ViabilityReport, hold: HoldState): ViabilityReport {
  if (!hold.over) return report;
  return {
    ...report,
    viable: false,
    problems: [
      ...report.problems,
      {
        code: 'HOLD_OVER_CAPACITY',
        message: `The load does not fit: ${hold.used} cargo space needed for the spare parts and ore, ${hold.capacity} available.`,
      },
    ],
  };
}
