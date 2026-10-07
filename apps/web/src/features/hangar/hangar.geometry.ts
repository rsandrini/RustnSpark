import type { PartCatalogStats, Placement } from '../../api/generated';
import { rotateSide, type Side } from './connectors';

// Pure client-side geometry for drag/snap feedback: footprints swap on right-angle rotation.
// Which cells exist comes from the ship's own format (`ship.yard.cells`), which also
// re-validates every preview and the save (D20) — the client owns no copy of the shape beyond
// what it was just given to render.

export type Rot = 0 | 90 | 180 | 270;
const QUARTER = 90;
const HALF = 180;
const FULL_TURN = 360;

/** Next rotation when the player presses Rotate: a clockwise quarter turn. */
export function nextRot(rot: Rot): Rot {
  return ((rot + QUARTER) % FULL_TURN) as Rot;
}

export function footprint(
  catalog: PartCatalogStats,
  rot: Rot,
): { width: number; height: number } {
  return rot % HALF !== 0
    ? { width: catalog.h, height: catalog.w }
    : { width: catalog.w, height: catalog.h };
}

/** Why a placement is refused — the first problem found, in this order. */
export type PlacementIssue = 'bounds' | 'overlap' | 'exhaust' | 'facing';

const FACING_VECTOR: Record<Side, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

/** Engines and weapons face W at rot 0 and turn with the placement (spec: part direction rules). */
export function facingOf(rot: Rot): Side {
  return rotateSide('W', rot);
}

function cellsOf(
  placement: Placement,
  catalog: PartCatalogStats,
): Array<{ x: number; y: number }> {
  const { width, height } = footprint(catalog, placement.rot);
  const out: Array<{ x: number; y: number }> = [];
  for (let dx = 0; dx < width; dx += 1) {
    for (let dy = 0; dy < height; dy += 1) out.push({ x: placement.gx + dx, y: placement.gy + dy });
  }
  return out;
}

export interface DirectionViolation {
  /** The engine/weapon whose rear/firing half-plane is not empty. */
  partInstanceId: string;
  kind: 'exhaust' | 'facing';
  /** Every other part with a cell beyond its facing edge. */
  blockers: ReadonlySet<string>;
}

/**
 * Half-plane rule (literal): an ENGINE (exhaust) or WEAPON (firing line) may have no other part's
 * cell beyond its facing edge, anywhere across the ship. Project every cell onto the facing
 * direction; any other part's projection above this part's own maximum is a violation.
 * Mirrors apps/api/src/ships/direction.ts — both pinned by
 * packages/contract/fixtures/direction-vectors.json.
 */
export function directionViolations(
  layout: readonly Placement[],
  catalogById: ReadonlyMap<string, PartCatalogStats>,
): DirectionViolation[] {
  const out: DirectionViolation[] = [];
  for (const placement of layout) {
    const catalog = catalogById.get(placement.partInstanceId);
    if (catalog === undefined) continue;
    if (catalog.partClass !== 'ENGINE' && catalog.partClass !== 'WEAPON') continue;
    const f = FACING_VECTOR[facingOf(placement.rot)];
    const project = (cell: { x: number; y: number }) => cell.x * f.x + cell.y * f.y;
    const limit = Math.max(...cellsOf(placement, catalog).map(project));
    const blockers = new Set<string>();
    for (const other of layout) {
      if (other.partInstanceId === placement.partInstanceId) continue;
      const otherCatalog = catalogById.get(other.partInstanceId);
      if (otherCatalog === undefined) continue;
      if (cellsOf(other, otherCatalog).some((cell) => project(cell) > limit)) {
        blockers.add(other.partInstanceId);
      }
    }
    if (blockers.size > 0) {
      out.push({
        partInstanceId: placement.partInstanceId,
        kind: catalog.partClass === 'ENGINE' ? 'exhaust' : 'facing',
        blockers,
      });
    }
  }
  return out;
}

/**
 * First reason the part cannot go at (gx, gy, rot), or null. The direction rule counts both ways:
 * the moved part's own facing half-plane, and the moved part standing in another engine's/weapon's.
 * Violations that exist without involving this part (a legacy layout) never block moving it.
 */
export function placementIssue(
  layout: readonly Placement[],
  catalogById: ReadonlyMap<string, PartCatalogStats>,
  partInstanceId: string,
  gx: number,
  gy: number,
  rot: Rot,
  cells: ReadonlySet<string>,
): PlacementIssue | null {
  const catalog = catalogById.get(partInstanceId);
  if (catalog === undefined) return 'bounds';
  const { width, height } = footprint(catalog, rot);
  for (let dx = 0; dx < width; dx += 1) {
    for (let dy = 0; dy < height; dy += 1) {
      if (!cells.has(`${gx + dx},${gy + dy}`)) return 'bounds';
    }
  }
  for (const placement of layout) {
    if (placement.partInstanceId === partInstanceId) continue;
    const other = catalogById.get(placement.partInstanceId);
    if (other === undefined) continue;
    const otherFoot = footprint(other, placement.rot);
    const overlaps =
      gx < placement.gx + otherFoot.width &&
      placement.gx < gx + width &&
      gy < placement.gy + otherFoot.height &&
      placement.gy < gy + height;
    if (overlaps) return 'overlap';
  }
  const candidate = [
    ...layout.filter((placement) => placement.partInstanceId !== partInstanceId),
    { partInstanceId, gx, gy, rot },
  ];
  for (const violation of directionViolations(candidate, catalogById)) {
    if (violation.partInstanceId === partInstanceId || violation.blockers.has(partInstanceId)) {
      return violation.kind;
    }
  }
  return null;
}

export function canPlace(
  layout: readonly Placement[],
  catalogById: ReadonlyMap<string, PartCatalogStats>,
  partInstanceId: string,
  gx: number,
  gy: number,
  rot: Rot,
  cells: ReadonlySet<string>,
): boolean {
  return placementIssue(layout, catalogById, partInstanceId, gx, gy, rot, cells) === null;
}
