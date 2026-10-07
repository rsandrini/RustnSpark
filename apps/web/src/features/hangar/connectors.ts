import type { ConnectorCell, PartCatalogStats, Placement } from '../../api/generated';

// Client mirror of the server's connector rules (apps/api/src/parts/connectors.ts and the
// connectivity flood-fill in apps/api/src/ships/geometry.ts) — the client cannot import API code.
// Both sides are pinned by the shared vectors in packages/contract/fixtures/connector-vectors.json.

export type Side = ConnectorCell['side'];
export type Kind = ConnectorCell['kind'];
export type Rot = 0 | 90 | 180 | 270;
export type PortState = 'connected' | 'incorrect' | 'available';

const SIDES: readonly Side[] = ['N', 'E', 'S', 'W'];
const QUARTER_TURN = 90;
const FULL_TURN_QUARTERS = 4;

/** central<->central, split<->split, universal<->anything-but-none; none never matches. */
export function kindCompatible(a: Kind, b: Kind): boolean {
  if (a === 'none' || b === 'none') return false;
  if (a === 'universal' || b === 'universal') return true;
  return a === b;
}

/** The world-facing side an authored side ends up on after `rot` clockwise degrees. */
export function rotateSide(side: Side, rot: Rot): Side {
  const quarters = rot / QUARTER_TURN;
  return SIDES[(SIDES.indexOf(side) + quarters) % FULL_TURN_QUARTERS] as Side;
}

/** Inverse of `rotateSide`: which authored side faces `side` in the world at `rot`. */
export function authoredSide(side: Side, rot: Rot): Side {
  const quarters = rot / QUARTER_TURN;
  return SIDES[(SIDES.indexOf(side) - quarters + FULL_TURN_QUARTERS) % FULL_TURN_QUARTERS] as Side;
}

/** Where an authored cell (dx, dy) of a w x h part lands in the placed footprint at `rot`. */
export function authoredToWorld(
  dx: number,
  dy: number,
  w: number,
  h: number,
  rot: Rot,
): { x: number; y: number } {
  let x = dx;
  let y = dy;
  let width = w;
  let height = h;
  for (let turn = 0; turn < rot / QUARTER_TURN; turn += 1) {
    [x, y, width, height] = [height - 1 - y, x, height, width];
  }
  return { x, y };
}

const OFFSETS: Record<Side, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};
const OPPOSITE: Record<Side, Side> = { N: 'S', E: 'W', S: 'N', W: 'E' };

export interface PortMark {
  partInstanceId: string;
  /** Absolute grid cell the mark sits in, and the world-facing side of that cell. */
  x: number;
  y: number;
  side: Side;
  kind: Kind;
  state: PortState;
}

interface WorldCell {
  partInstanceId: string;
  /** World side -> kind for this cell (only sides the part actually carries a connector on). */
  kinds: Map<Side, Kind>;
}

/**
 * Every visible port mark for a layout: one per connector side that is not `none`.
 * - `connected`: the neighbouring cell belongs to another part and the pair is compatible
 * - `incorrect`: a neighbouring part sits there but the pair is incompatible / the other side is none
 * - `available`: nothing is attached on that side
 * A part with no stored connectors (legacy/universal fallback) draws no marks; as a neighbour it
 * counts as `universal` on every side, exactly like the server.
 */
export function computePortMarks(
  layout: readonly Placement[],
  catalogById: ReadonlyMap<string, PartCatalogStats>,
  connectorsById: ReadonlyMap<string, readonly ConnectorCell[]>,
): PortMark[] {
  const world = new Map<string, WorldCell>();
  const occupied = new Map<string, string>();
  for (const placement of layout) {
    const catalog = catalogById.get(placement.partInstanceId);
    if (catalog === undefined) continue;
    const cells = connectorsById.get(placement.partInstanceId) ?? [];
    const width = placement.rot % 180 === 0 ? catalog.w : catalog.h;
    const height = placement.rot % 180 === 0 ? catalog.h : catalog.w;
    for (let x = 0; x < width; x += 1) {
      for (let y = 0; y < height; y += 1) {
        occupied.set(`${placement.gx + x},${placement.gy + y}`, placement.partInstanceId);
      }
    }
    for (const cell of cells) {
      const at = authoredToWorld(cell.dx, cell.dy, catalog.w, catalog.h, placement.rot);
      const key = `${placement.gx + at.x},${placement.gy + at.y}`;
      const entry = world.get(key) ?? { partInstanceId: placement.partInstanceId, kinds: new Map() };
      entry.kinds.set(rotateSide(cell.side, placement.rot), cell.kind);
      world.set(key, entry);
    }
  }

  const marks: PortMark[] = [];
  for (const [key, entry] of world) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    for (const [side, kind] of entry.kinds) {
      if (kind === 'none') continue;
      const offset = OFFSETS[side];
      const neighborKey = `${x + offset.dx},${y + offset.dy}`;
      const neighborId = occupied.get(neighborKey);
      let state: PortState = 'available';
      if (neighborId !== undefined && neighborId !== entry.partInstanceId) {
        const hasLayout = (connectorsById.get(neighborId)?.length ?? 0) > 0;
        const neighborKind: Kind = hasLayout
          ? (world.get(neighborKey)?.kinds.get(OPPOSITE[side]) ?? 'none')
          : 'universal';
        state = kindCompatible(kind, neighborKind) ? 'connected' : 'incorrect';
      } else if (neighborId === entry.partInstanceId) {
        continue; // a part's own adjacent cells never need a connector
      }
      marks.push({ partInstanceId: entry.partInstanceId, x, y, side, kind, state });
    }
  }
  return marks;
}
