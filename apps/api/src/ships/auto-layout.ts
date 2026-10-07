import type { InstalledPart, PartCatalog, Placement } from '../parts/part.types.js';
import type { ConnectorLayout } from '../parts/connectors.js';
import { CLASSIC_SQUARE_CELLS, connectedPartIds, validateLayout } from './geometry.js';

const RIGHT_ANGLE = 90;

export function autoLayout(
  parts: InstalledPart[],
  catalog: ReadonlyMap<string, PartCatalog>,
  formatCells: ReadonlySet<string> = CLASSIC_SQUARE_CELLS,
): Placement[] {
  const ordered = [...parts].sort((a, b) => {
    return Number(b.catalog.partClass === 'BRIDGE') - Number(a.catalog.partClass === 'BRIDGE');
  });

  const placements: Placement[] = [];
  // Parts that carry their stored connectors are only placed where they actually connect back to
  // the bridge — plain adjacency is no longer enough once real (non-universal) layouts exist,
  // e.g. an engine with its exhaust side (none) facing the only neighbour.
  const connectors = new Map<string, ConnectorLayout | null>(
    parts
      .filter((part) => part.instance.connectors !== undefined)
      .map((part) => [part.instance.id, part.instance.connectors as ConnectorLayout | null]),
  );

  for (const part of ordered) {
    const placement = findPlacement(part, placements, catalog, formatCells, connectors);
    if (placement !== null) {
      placements.push(placement);
    }
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

  const rotations = [0, RIGHT_ANGLE];
  const candidates = candidatePositions(existing);

  for (const { gx, gy } of candidates) {
    for (const rot of rotations) {
      const placement: Placement = { partInstanceId: part.instance.id, gx, gy, rot };
      const errors = validateLayout([...existing, placement], catalog, formatCells);
      const relevant = errors.filter((error) => error.partInstanceId === part.instance.id);
      if (relevant.length > 0) continue;
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
