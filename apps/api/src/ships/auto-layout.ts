import type { InstalledPart, PartCatalog, Placement } from '../parts/part.types.js';
import { validateLayout } from './geometry.js';

const RIGHT_ANGLE = 90;

export function autoLayout(parts: InstalledPart[], catalog: ReadonlyMap<string, PartCatalog>): Placement[] {
  const ordered = [...parts].sort((a, b) => {
    return Number(b.catalog.partClass === 'BRIDGE') - Number(a.catalog.partClass === 'BRIDGE');
  });

  const placements: Placement[] = [];

  for (const part of ordered) {
    const placement = findPlacement(part, placements, catalog);
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
): Placement | null {
  if (part.catalog.partClass === 'BRIDGE') {
    return { partInstanceId: part.instance.id, gx: 0, gy: 0, rot: 0 };
  }

  const rotations = [0, RIGHT_ANGLE];
  const candidates = candidatePositions(existing);

  for (const { gx, gy } of candidates) {
    for (const rot of rotations) {
      const placement: Placement = { partInstanceId: part.instance.id, gx, gy, rot };
      const errors = validateLayout([...existing, placement], catalog);
      const relevant = errors.filter((error) => error.partInstanceId === part.instance.id || error.code === 'DISCONNECTED');
      if (relevant.length === 0) {
        return placement;
      }
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

function* ringAround(cx: number, cy: number, radius: number): Generator<{ gx: number; gy: number }> {
  for (let dx = -radius; dx <= radius; dx += 1) {
    yield { gx: cx + dx, gy: cy - radius };
    yield { gx: cx + dx, gy: cy + radius };
  }
  for (let dy = -radius + 1; dy <= radius - 1; dy += 1) {
    yield { gx: cx - radius, gy: cy + dy };
    yield { gx: cx + radius, gy: cy + dy };
  }
}
