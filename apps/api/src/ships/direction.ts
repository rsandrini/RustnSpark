import type { ConnectorLayout, ConnectorSide } from '../parts/connectors.js';
import { authoredSideAt, rotateSide, worldToAuthoredCell } from '../parts/connectors.js';
import type { LayoutError, PartCatalog, Placement } from '../parts/part.types.js';
import type { ViabilityProblem } from './viability.js';

// Part direction rules: ENGINEs have an exhaust and WEAPONs a firing line, both facing W at rot 0
// and turning clockwise with the placement's `rot`. The half-plane rule is literal — no other
// part's cell may lie beyond the part's facing edge, anywhere across the ship — so an engine can
// only sit on the back edge and a weapon only on the border of the side it points to.
// Mirrored by apps/web/src/features/hangar/hangar.geometry.ts (directionViolations); both are
// pinned by packages/contract/fixtures/direction-vectors.json.

const BASE_FACING: ConnectorSide = 'W';
const VECTOR: Record<ConnectorSide, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};
const HALF_TURN = 180;

export function isDirectional(partClass: string): boolean {
  return partClass === 'ENGINE' || partClass === 'WEAPON';
}

export function facingSide(rot: number): ConnectorSide {
  return rotateSide(BASE_FACING, rot);
}

function worldCells(placement: Placement, part: PartCatalog): Array<{ x: number; y: number; dx: number; dy: number }> {
  const swapped = placement.rot % HALF_TURN !== 0;
  const width = swapped ? part.h : part.w;
  const height = swapped ? part.w : part.h;
  const cells: Array<{ x: number; y: number; dx: number; dy: number }> = [];
  for (let dx = 0; dx < width; dx += 1) {
    for (let dy = 0; dy < height; dy += 1) {
      cells.push({ x: placement.gx + dx, y: placement.gy + dy, dx, dy });
    }
  }
  return cells;
}

/** EXHAUST_BLOCKED / FACING_BLOCKED for every engine/weapon with another part beyond its facing
    edge, plus FACING_CONNECTOR for one whose facing side carries a connector. The connector check
    is skipped for a part with no stored layout (legacy / universal fallback). */
export function directionErrors(
  placements: readonly Placement[],
  catalog: ReadonlyMap<string, PartCatalog>,
  connectorsByInstance: ReadonlyMap<string, ConnectorLayout | null> = new Map(),
): LayoutError[] {
  const errors: LayoutError[] = [];
  for (const placement of placements) {
    const part = catalog.get(placement.partInstanceId);
    if (part === undefined || !isDirectional(part.partClass)) continue;
    const facing = facingSide(placement.rot);
    const f = VECTOR[facing];
    const project = (cell: { x: number; y: number }): number => cell.x * f.x + cell.y * f.y;
    const own = worldCells(placement, part);
    const limit = Math.max(...own.map(project));

    const blocked = placements.some((other) => {
      if (other.partInstanceId === placement.partInstanceId) return false;
      const otherPart = catalog.get(other.partInstanceId);
      return otherPart !== undefined && worldCells(other, otherPart).some((cell) => project(cell) > limit);
    });
    if (blocked) {
      const exhaust = part.partClass === 'ENGINE';
      errors.push({
        code: exhaust ? 'EXHAUST_BLOCKED' : 'FACING_BLOCKED',
        partInstanceId: placement.partInstanceId,
        message: exhaust
          ? `Engine ${placement.partInstanceId} has parts behind its exhaust.`
          : `Weapon ${placement.partInstanceId} has parts in its line of fire.`,
      });
    }

    const layout = connectorsByInstance.get(placement.partInstanceId);
    if (layout !== null && layout !== undefined && layout.cells.length > 0) {
      const authoredFacing = authoredSideAt(facing, placement.rot);
      const edge = own.filter((cell) => !own.some((o) => o.x === cell.x + f.x && o.y === cell.y + f.y));
      const hasConnector = edge.some((cell) => {
        const authored = worldToAuthoredCell(cell.dx, cell.dy, part.w, part.h, placement.rot);
        return layout.cells.some(
          (c) =>
            c.dx === authored.dx && c.dy === authored.dy && c.side === authoredFacing && c.kind !== 'none',
        );
      });
      if (hasConnector) {
        errors.push({
          code: 'FACING_CONNECTOR',
          partInstanceId: placement.partInstanceId,
          message: `Part ${placement.partInstanceId} has a connector on its facing side.`,
        });
      }
    }
  }
  return errors;
}

/** Direction rules as flight-viability problems: layout editing stays free, but a ship with an
    engine/weapon that has parts behind its facing edge (or a connector on it) cannot fly. */
export function withDirectionProblems(
  viability: { viable: boolean; problems: ViabilityProblem[] },
  placements: readonly Placement[],
  catalog: ReadonlyMap<string, PartCatalog>,
  connectorsByInstance: ReadonlyMap<string, ConnectorLayout | null>,
): { viable: boolean; problems: ViabilityProblem[] } {
  const extra = directionErrors(placements, catalog, connectorsByInstance).map(
    (error): ViabilityProblem => ({
      code: error.code as ViabilityProblem['code'],
      message: error.message,
    }),
  );
  if (extra.length === 0) return viability;
  // one entry per code (several engines blocked is still one problem for the pilot to read)
  const seen = new Set(viability.problems.map((problem) => problem.code));
  const unique = extra.filter((problem) => !seen.has(problem.code) && seen.add(problem.code));
  return { viable: false, problems: [...viability.problems, ...unique] };
}
