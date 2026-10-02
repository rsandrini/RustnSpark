import type { PartCatalog, Placement, LayoutError } from '../parts/part.types.js';
import {
  compatible,
  RIGHT_ANGLE,
  sideKindAt,
  type ConnectorLayout,
} from '../parts/connectors.js';

/** Yard cells run [-GRID_HALF_SIZE, GRID_HALF_SIZE) on both axes — retained only as the admin
    format-drawing tool's canvas ceiling, not a gameplay constant: which cells actually exist
    comes from the ship's own ShipFormat. */
export const GRID_HALF_SIZE = 10;

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

interface OccupiedCell {
  readonly partInstanceId: string;
  /** This cell's offset within its part's own (unrotated) footprint — needed to look up that
      cell's own connector sides, since connector data is authored per (dx, dy), not per
      absolute grid position. */
  readonly dx: number;
  readonly dy: number;
}

function footprintCells(
  placement: Placement,
  part: PartCatalog,
): Array<{ x: number; y: number; dx: number; dy: number }> {
  const width = placement.rot === RIGHT_ANGLE ? part.h : part.w;
  const height = placement.rot === RIGHT_ANGLE ? part.w : part.h;
  const cells: Array<{ x: number; y: number; dx: number; dy: number }> = [];
  for (let dx = 0; dx < width; dx += 1) {
    for (let dy = 0; dy < height; dy += 1) {
      cells.push({ x: placement.gx + dx, y: placement.gy + dy, dx, dy });
    }
  }
  return cells;
}

export function validateLayout(
  placements: Placement[],
  catalog: ReadonlyMap<string, PartCatalog>,
  formatCells: ReadonlySet<string> = CLASSIC_SQUARE_CELLS,
  connectorsByInstance: ReadonlyMap<string, ConnectorLayout | null> = new Map(),
): LayoutError[] {
  const errors: LayoutError[] = [];
  const occupied = new Map<string, OccupiedCell>();

  for (const placement of placements) {
    const part = catalog.get(placement.partInstanceId);
    if (part === undefined) {
      // A part instance the caller doesn't know about at all can't be geometrically checked —
      // treat it as simply not occupying any cells (OUT_OF_BOUNDS/OVERLAP don't apply to it).
      continue;
    }

    for (const { x, y, dx, dy } of footprintCells(placement, part)) {
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
      if (existing !== undefined && existing.partInstanceId !== placement.partInstanceId) {
        if (!hasError(errors, 'OVERLAP')) {
          errors.push({
            code: 'OVERLAP',
            partInstanceId: placement.partInstanceId,
            message: `Part ${placement.partInstanceId} overlaps ${existing.partInstanceId}.`,
          });
        }
      }
      occupied.set(key, { partInstanceId: placement.partInstanceId, dx, dy });
    }
  }

  return errors;
}

function hasError(errors: LayoutError[], code: LayoutError['code']): boolean {
  return errors.some((error) => error.code === code);
}

const NEIGHBOR_OFFSETS: ReadonlyArray<{
  dx: 0 | 1 | -1;
  dy: 0 | 1 | -1;
  from: 'N' | 'E' | 'S' | 'W';
  to: 'N' | 'E' | 'S' | 'W';
}> = [
  { dx: 0, dy: -1, from: 'N', to: 'S' },
  { dx: 1, dy: 0, from: 'E', to: 'W' },
  { dx: 0, dy: 1, from: 'S', to: 'N' },
  { dx: -1, dy: 0, from: 'W', to: 'E' },
];

/** Bridge-rooted flood-fill (Connectors v0.1): a neighbor cell is only reachable through an
    edge where BOTH facing sides have a compatible connector (rotation-aware) — plain adjacency
    is necessary but no longer sufficient. Returns every part-instance id reachable from the
    bridge, including the bridge's own id (always "connected" to itself, the flood-fill's
    root). A ship with no bridge in the layout returns an empty set. */
export function connectedPartIds(
  placements: Placement[],
  catalog: ReadonlyMap<string, PartCatalog>,
  connectorsByInstance: ReadonlyMap<string, ConnectorLayout | null>,
): Set<string> {
  const occupied = new Map<string, OccupiedCell>();
  const rotByInstance = new Map<string, number>();
  for (const placement of placements) {
    const part = catalog.get(placement.partInstanceId);
    if (part === undefined) continue;
    rotByInstance.set(placement.partInstanceId, placement.rot);
    for (const { x, y, dx, dy } of footprintCells(placement, part)) {
      occupied.set(cellKey(x, y), { partInstanceId: placement.partInstanceId, dx, dy });
    }
  }

  const bridgePlacement = placements.find(
    (p) => catalog.get(p.partInstanceId)?.partClass === 'BRIDGE',
  );
  if (bridgePlacement === undefined) return new Set();
  const startKey = cellKey(bridgePlacement.gx, bridgePlacement.gy);
  if (!occupied.has(startKey)) return new Set();

  // rotateSide(side, 90) gives the rotated-WORLD side for a given unrotated-AUTHORED side
  // (used when drawing/placing). Here we need the inverse — given a world-facing side, which
  // authored side produced it — which for a 4-cycle 90° clockwise rotation is one step
  // counter-clockwise. A direct reverse-lookup table, rather than three chained forward
  // rotations, keeps that inverse obvious on inspection instead of resting on modular
  // arithmetic ("270 clockwise == 90 counter-clockwise").
  const ROTATE_CCW: Record<'N' | 'E' | 'S' | 'W', 'N' | 'E' | 'S' | 'W'> = {
    N: 'W',
    W: 'S',
    S: 'E',
    E: 'N',
  };
  const connectedKindAt = (
    cell: OccupiedCell,
    side: 'N' | 'E' | 'S' | 'W',
  ): ReturnType<typeof sideKindAt> => {
    const rot = rotByInstance.get(cell.partInstanceId) ?? 0;
    const authoredSide = rot === 0 ? side : ROTATE_CCW[side];
    return sideKindAt(
      connectorsByInstance.get(cell.partInstanceId) ?? null,
      cell.dx,
      cell.dy,
      authoredSide,
    );
  };

  const visitedCells = new Set<string>([startKey]);
  const connectedParts = new Set<string>();
  const queue: string[] = [startKey];

  while (queue.length > 0) {
    const key = queue.shift()!;
    const cell = occupied.get(key)!;
    connectedParts.add(cell.partInstanceId);
    const [xRaw, yRaw] = key.split(',');
    const x = Number(xRaw);
    const y = Number(yRaw);

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighborKey = cellKey(x + offset.dx, y + offset.dy);
      if (visitedCells.has(neighborKey)) continue;
      const neighbor = occupied.get(neighborKey);
      if (neighbor === undefined) continue;
      if (neighbor.partInstanceId === cell.partInstanceId) {
        // Same physical part's own adjacent cell — always "connected" within itself, no
        // connector needed between a part's own cells.
        visitedCells.add(neighborKey);
        queue.push(neighborKey);
        continue;
      }
      const hereKind = connectedKindAt(cell, offset.from);
      const thereKind = connectedKindAt(neighbor, offset.to);
      if (compatible(hereKind, thereKind)) {
        visitedCells.add(neighborKey);
        queue.push(neighborKey);
      }
    }
  }

  return connectedParts;
}
