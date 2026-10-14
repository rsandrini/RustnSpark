import type { InstalledPart, PartCatalog, Placement } from '../parts/part.types.js';
import { ROTATIONS, type ConnectorLayout } from '../parts/connectors.js';
import { directionErrors } from './direction.js';
import {
  CLASSIC_SQUARE_CELLS,
  connectedPartIds,
  incorrectPortPartIds,
  validateLayout,
} from './geometry.js';

// All four facings: an engine/weapon may need turning so nothing is behind its exhaust/muzzle.

export function autoLayout(
  parts: InstalledPart[],
  catalog: ReadonlyMap<string, PartCatalog>,
  formatCells: ReadonlySet<string> = CLASSIC_SQUARE_CELLS,
): Placement[] {
  // Parts that carry their stored connectors are only placed where they actually connect back to
  // the bridge — plain adjacency is no longer enough once real (non-universal) layouts exist,
  // e.g. an engine with its exhaust side (none) facing the only neighbour.
  const connectors = connectorMap(parts);

  // A part only ever lands next to one already placed, so the order decides which neighbours
  // exist when it is its turn: a battery whose single port needs a hull's west side is unplaceable
  // until the hull is down, but trivial once it is. The first pass uses the caller's order; the
  // retries walk each part to the front and to the back in turn, which is enough to seat the parts
  // whose compatibility is two steps ahead of them. The first complete layout wins.
  let best: Placement[] = [];
  for (const ordered of orderings(parts)) {
    const placements: Placement[] = [];
    for (const part of ordered) {
      const placement = findPlacement(part, placements, catalog, formatCells, connectors);
      if (placement !== null) placements.push(placement);
    }
    if (placements.length === parts.length) return placements;
    if (placements.length > best.length) best = placements;
  }
  return best;
}

function connectorMap(
  parts: readonly InstalledPart[],
): Map<string, ConnectorLayout | null> {
  return new Map(
    parts
      .filter((part) => part.instance.connectors !== undefined)
      .map((part) => [part.instance.id, part.instance.connectors as ConnectorLayout | null]),
  );
}

/** Caller's order first, then every part lifted to the front and pushed to the back. */
function* orderings(parts: readonly InstalledPart[]): Generator<InstalledPart[]> {
  const bridges = parts.filter((part) => part.catalog.partClass === 'BRIDGE');
  const rest = parts.filter((part) => part.catalog.partClass !== 'BRIDGE');

  yield [...bridges, ...rest];
  for (let index = 0; index < rest.length; index += 1) {
    const pivot = rest[index]!;
    yield [...bridges, pivot, ...rest.filter((_, i) => i !== index)];
  }
  for (let index = 0; index < rest.length; index += 1) {
    const pivot = rest[index]!;
    yield [...bridges, ...rest.filter((_, i) => i !== index), pivot];
  }
}

/**
 * Adds `added` to a layout that already stands, without moving anything: each new part takes the
 * first free spot where it fits and connects. Used by the compare preview, which must show what
 * the ship does with the part ADDED to its real arrangement — re-packing everything from scratch
 * gives another layout whose connections differ, so the comparison would measure the re-pack
 * instead of the part. A part with no free spot is simply not placed (the caller reports it).
 */
export function extendLayout(
  existing: readonly Placement[],
  added: readonly InstalledPart[],
  everyPart: readonly InstalledPart[],
  formatCells: ReadonlySet<string> = CLASSIC_SQUARE_CELLS,
): Placement[] {
  const catalog = new Map<string, PartCatalog>(everyPart.map((p) => [p.instance.id, p.catalog]));
  const connectors = new Map<string, ConnectorLayout | null>(
    everyPart
      .filter((part) => part.instance.connectors !== undefined)
      .map((part) => [part.instance.id, part.instance.connectors as ConnectorLayout | null]),
  );
  const placements = [...existing];
  for (const part of added) {
    const placement = findPlacement(part, placements, catalog, formatCells, connectors);
    if (placement !== null) placements.push(placement);
  }
  return placements;
}

function findPlacement(
  part: InstalledPart,
  existing: Placement[],
  catalog: ReadonlyMap<string, PartCatalog>,
  formatCells: ReadonlySet<string>,
  connectors: ReadonlyMap<string, ConnectorLayout | null>,
): Placement | null {
  if (part.catalog.partClass === 'BRIDGE') {
    return { partInstanceId: part.instance.id, gx: 0, gy: 0, rot: 0 };
  }
  // A part no rotation can cover the yard with never lands, so don't spend the whole candidate
  // sweep looking for the spot. One oversized part used to push every ordering to its limit.
  if (!canEverFit(part.catalog, formatCells)) return null;

  const rotations = ROTATIONS;
  const candidates = candidatePositions(existing);

  for (const { gx, gy } of candidates) {
    for (const rot of rotations) {
      const placement: Placement = { partInstanceId: part.instance.id, gx, gy, rot };
      const errors = validateLayout([...existing, placement], catalog, formatCells, connectors);
      const relevant = errors.filter((error) => error.partInstanceId === part.instance.id);
      if (relevant.length > 0) continue;
      // Direction errors land on the engine/weapon, not on the part that blocks it, so a newly
      // placed part is rejected for any (the layout so far is clean, so any is new). Auto-layout
      // always produces a layout that satisfies them; manual editing is allowed to break them.
      if (directionErrors([...existing, placement], catalog, connectors).length > 0) continue;
      // A connector pressed against a side that does not fit is a red port that keeps the ship on
      // the ground (PORT_INCORRECT). Saving is allowed to pass through that state, but auto-layout
      // must not create it: reject any candidate that makes a part — the new one or a neighbour —
      // sit against an incompatible port. The layout so far is clean, so any red here is new.
      if (incorrectPortPartIds([...existing, placement], catalog, connectors).size > 0) continue;
      if (
        connectors.size > 0 &&
        !connectedPartIds([...existing, placement], catalog, connectors).has(part.instance.id)
      ) {
        continue;
      }
      return placement;
    }
  }

  return null;
}

const formatSpans = new WeakMap<ReadonlySet<string>, { x: number; y: number }>();

/** Whether some rotation's bounding box fits inside the yard's. Exact for a rectangular yard and
    only ever a necessary condition otherwise, so it can skip a hopeless sweep and never reject a
    spot that was actually reachable. */
function canEverFit(catalog: PartCatalog, formatCells: ReadonlySet<string>): boolean {
  let span = formatSpans.get(formatCells);
  if (span === undefined) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const cell of formatCells) {
      const comma = cell.indexOf(',');
      const x = Number(cell.slice(0, comma));
      const y = Number(cell.slice(comma + 1));
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    span = { x: maxX - minX + 1, y: maxY - minY + 1 };
    formatSpans.set(formatCells, span);
  }
  const long = Math.max(catalog.w, catalog.h);
  const short = Math.min(catalog.w, catalog.h);
  return long <= Math.max(span.x, span.y) && short <= Math.min(span.x, span.y);
}

function* candidatePositions(existing: Placement[]): Generator<{ gx: number; gy: number }> {
  const seen = new Set<string>();
  const radiusLimit = 20;

  for (const placement of existing) {
    for (let radius = 1; radius <= radiusLimit; radius += 1) {
      for (const { gx, gy } of ringAround(placement.gx, placement.gy, radius)) {
        const key = `${gx},${gy}`;
        if (!seen.has(key)) {
          seen.add(key);
          yield { gx, gy };
        }
      }
    }
  }
}

function* ringAround(
  cx: number,
  cy: number,
  radius: number,
): Generator<{ gx: number; gy: number }> {
  for (let dx = -radius; dx <= radius; dx += 1) {
    yield { gx: cx + dx, gy: cy - radius };
    yield { gx: cx + dx, gy: cy + radius };
  }
  for (let dy = -radius + 1; dy <= radius - 1; dy += 1) {
    yield { gx: cx - radius, gy: cy + dy };
    yield { gx: cx + radius, gy: cy + dy };
  }
}
