import type { PartCatalog, Placement, LayoutError } from '../parts/part.types.js';

const GRID_HALF_SIZE = 10;
const RIGHT_ANGLE = 90;

export function validateLayout(
  placements: Placement[],
  catalog: ReadonlyMap<string, PartCatalog>,
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
        if (
          x < -GRID_HALF_SIZE ||
          x >= GRID_HALF_SIZE ||
          y < -GRID_HALF_SIZE ||
          y >= GRID_HALF_SIZE
        ) {
          if (!hasError(errors, 'OUT_OF_BOUNDS')) {
            errors.push({
              code: 'OUT_OF_BOUNDS',
              partInstanceId: placement.partInstanceId,
              message: `Part ${placement.partInstanceId} is outside the grid.`,
            });
          }
        }
        const key = `${x},${y}`;
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
  const startKey = `${start.gx},${start.gy}`;
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
  return [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`];
}
