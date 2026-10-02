import type { PartCatalog, Placement, LayoutError } from '../parts/part.types.js';

/** Yard cells run [-GRID_HALF_SIZE, GRID_HALF_SIZE) on both axes — retained only as the admin
    format-drawing tool's canvas ceiling (apps/web's grid editor), not a gameplay constant
    anymore: which cells actually exist now comes from the ship's own ShipFormat. */
export const GRID_HALF_SIZE = 10;
const RIGHT_ANGLE = 90;

/** The same "x,y" key format `validateLayout`'s internal occupancy map already used — exported
    so callers can turn a format's raw [[x,y],...] cell list into the Set this function needs. */
export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

function classicSquareCells(): [number, number][] {
  const cells: [number, number][] = [];
  for (let y = -GRID_HALF_SIZE; y < GRID_HALF_SIZE; y += 1) {
    for (let x = -GRID_HALF_SIZE; x < GRID_HALF_SIZE; x += 1) {
      cells.push([x, y]);
    }
  }
  return cells;
}

export const CLASSIC_SQUARE_CELLS: ReadonlySet<string> = new Set(
  classicSquareCells().map(([x, y]) => cellKey(x, y)),
);

const CELL_DIMENSIONS = 2;

export function formatCellsFromJson(cells: unknown): ReadonlySet<string> {
  if (!Array.isArray(cells)) return new Set();
  const set = new Set<string>();
  for (const cell of cells) {
    if (
      Array.isArray(cell) &&
      cell.length === CELL_DIMENSIONS &&
      typeof cell[0] === 'number' &&
      typeof cell[1] === 'number'
    ) {
      set.add(cellKey(cell[0], cell[1]));
    }
  }
  return set;
}

export function validateLayout(
  placements: Placement[],
  catalog: ReadonlyMap<string, PartCatalog>,
  formatCells: ReadonlySet<string> = CLASSIC_SQUARE_CELLS,
): LayoutError[] {
  const errors: LayoutError[] = [];
  const occupied = new Map<string, string>();
  const placedIds = new Set(placements.map((p) => p.partInstanceId));

  for (const placement of placements) {
    const part = catalog.get(placement.partInstanceId);
    if (part === undefined) {
      errors.push({
        code: 'DISCONNECTED',
        partInstanceId: placement.partInstanceId,
        message: `Unknown part instance: ${placement.partInstanceId}`,
      });
      continue;
    }

    const width = placement.rot === RIGHT_ANGLE ? part.h : part.w;
    const height = placement.rot === RIGHT_ANGLE ? part.w : part.h;

    for (let dx = 0; dx < width; dx += 1) {
      for (let dy = 0; dy < height; dy += 1) {
        const x = placement.gx + dx;
        const y = placement.gy + dy;
        const key = cellKey(x, y);
        if (!formatCells.has(key)) {
          if (!hasError(errors, 'OUT_OF_BOUNDS')) {
            errors.push({
              code: 'OUT_OF_BOUNDS',
              partInstanceId: placement.partInstanceId,
              message: `Part ${placement.partInstanceId} is outside the ship's format.`,
            });
          }
        }
        const existing = occupied.get(key);
        if (existing !== undefined && existing !== placement.partInstanceId) {
          if (!hasError(errors, 'OVERLAP')) {
            errors.push({
              code: 'OVERLAP',
              partInstanceId: placement.partInstanceId,
              message: `Part ${placement.partInstanceId} overlaps ${existing}.`,
            });
          }
        }
        occupied.set(key, placement.partInstanceId);
      }
    }
  }

  const bridgePlacement = placements.find((p) => {
    const part = catalog.get(p.partInstanceId);
    return part?.partClass === 'BRIDGE';
  });

  if (placements.length > 0 && bridgePlacement === undefined) {
    errors.push({ code: 'DISCONNECTED', message: 'No bridge found in layout.' });
  }

  if (bridgePlacement !== undefined && placements.length > 1) {
    const reachable = reachablePartIds(occupied, bridgePlacement);
    for (const id of placedIds) {
      if (!reachable.has(id)) {
        if (!hasError(errors, 'DISCONNECTED')) {
          errors.push({
            code: 'DISCONNECTED',
            message: 'Some parts are not connected to the bridge.',
          });
        }
        break;
      }
    }
  }

  return errors;
}

function hasError(errors: LayoutError[], code: LayoutError['code']): boolean {
  return errors.some((error) => error.code === code);
}

function reachablePartIds(occupied: ReadonlyMap<string, string>, start: Placement): Set<string> {
  const startKey = cellKey(start.gx, start.gy);
  if (!occupied.has(startKey)) {
    return new Set();
  }

  const visitedCells = new Set<string>();
  const reachableParts = new Set<string>();
  const queue: string[] = [startKey];
  visitedCells.add(startKey);

  while (queue.length > 0) {
    const cell = queue.shift()!;
    const partId = occupied.get(cell);
    if (partId !== undefined) {
      reachableParts.add(partId);
    }
    for (const neighbor of edgeNeighbors(cell)) {
      if (!occupied.has(neighbor) || visitedCells.has(neighbor)) {
        continue;
      }
      visitedCells.add(neighbor);
      queue.push(neighbor);
    }
  }

  return reachableParts;
}

function edgeNeighbors(cell: string): string[] {
  const [xRaw, yRaw] = cell.split(',');
  const x = Number(xRaw);
  const y = Number(yRaw);
  return [cellKey(x + 1, y), cellKey(x - 1, y), cellKey(x, y + 1), cellKey(x, y - 1)];
}
