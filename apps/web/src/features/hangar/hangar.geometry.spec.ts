import { describe, expect, it } from 'vitest';
import directionVectors from '../../../../../packages/contract/fixtures/direction-vectors.json';
import {
  canPlace,
  directionViolations,
  facingOf,
  footprint,
  nextRot,
  placementIssue,
  type Rot,
} from './hangar.geometry';
import type { PartCatalogStats, Placement } from '../../api/generated';

function catalog(w: number, h: number): PartCatalogStats {
  return {
    partType: 'x', partClass: 'UTILITY', w, h, mass: 1, structureCost: 1, partHp: 1, basePrice: 0,
    pot: 0, pdf: 0, bli: 0, esc: 0, sen: 0, crg: 0, min: 0, energyCont: 0, energyCombat: 0,
    fuelCap: 0, fuelUse: 0, batCharge: 0, batOutput: 0, batInput: 0, pressurized: false,
    lifeSupport: false,
  };
}

describe('canPlace — format cell set', () => {
  it('rejects a cell outside the format even when it would fit inside the old square bound', () => {
    const cells = new Set(['0,0']); // a 1-cell format
    const catalogById = new Map([['p1', catalog(1, 1)]]);
    expect(canPlace([], catalogById, 'p1', 1, 0, 0, cells)).toBe(false);
    expect(canPlace([], catalogById, 'p1', 0, 0, 0, cells)).toBe(true);
  });

  it('rejects a multi-cell part that only partially fits the format', () => {
    const cells = new Set(['0,0']); // too small for a 2x1 part
    const catalogById = new Map([['p1', catalog(2, 1)]]);
    expect(canPlace([], catalogById, 'p1', 0, 0, 0, cells)).toBe(false);
  });
});

// ---- Part direction rules (half-plane) — shared vectors with the API ------------------------

function partOf(spec: { class: string; w: number; h: number }): PartCatalogStats {
  return { ...catalog(spec.w, spec.h), partClass: spec.class as PartCatalogStats['partClass'] };
}

describe('direction vectors (parity with apps/api/src/ships/direction.ts)', () => {
  for (const scenario of directionVectors.scenarios) {
    it(scenario.name, () => {
      const byId = new Map(
        Object.entries(scenario.parts as unknown as Record<string, { class: string; w: number; h: number }>).map(
          ([id, spec]) => [id, partOf(spec)],
        ),
      );
      const layout = (scenario.layout as { id: string; gx: number; gy: number; rot: Rot }[]).map(
        (p): Placement => ({ partInstanceId: p.id, gx: p.gx, gy: p.gy, rot: p.rot }),
      );
      const found = directionViolations(layout, byId)
        .map((v) => ({ id: v.partInstanceId, code: v.kind === 'exhaust' ? 'EXHAUST_BLOCKED' : 'FACING_BLOCKED' }))
        .sort((a, b) => a.id.localeCompare(b.id) || a.code.localeCompare(b.code));
      expect(found).toEqual(scenario.expected);
    });
  }

  it('facingOf matches the shared table', () => {
    for (const [rot, side] of Object.entries(directionVectors.facingOf)) {
      expect(facingOf(Number(rot) as Rot)).toBe(side);
    }
  });
});

describe('rotation and placementIssue', () => {
  it('footprints swap on quarter turns only', () => {
    const wide = catalog(3, 1);
    expect(footprint(wide, 0)).toEqual({ width: 3, height: 1 });
    expect(footprint(wide, 90)).toEqual({ width: 1, height: 3 });
    expect(footprint(wide, 180)).toEqual({ width: 3, height: 1 });
    expect(footprint(wide, 270)).toEqual({ width: 1, height: 3 });
  });

  it('rotate cycles all four facings', () => {
    expect([0, 90, 180, 270].map((r) => nextRot(r as Rot))).toEqual([90, 180, 270, 0]);
  });

  it('refuses only bounds and overlap; direction problems never block a placement', () => {
    const engine = partOf({ class: 'ENGINE', w: 1, h: 1 });
    const plain = partOf({ class: 'UTILITY', w: 1, h: 1 });
    const byId = new Map([['e', engine], ['p', plain]]);
    const cells = new Set(['0,0', '1,0', '2,0']);
    const withEngine: Placement[] = [{ partInstanceId: 'e', gx: 1, gy: 0, rot: 0 }];
    expect(placementIssue(withEngine, byId, 'p', 5, 5, 0, cells)).toBe('bounds');
    expect(placementIssue(withEngine, byId, 'p', 1, 0, 0, cells)).toBe('overlap');
    // west of an engine facing W is a direction PROBLEM, but the drop is allowed...
    expect(placementIssue(withEngine, byId, 'p', 0, 0, 0, cells)).toBeNull();
    // ...and shows up as a violation on the engine, blamed on the part standing there
    const after: Placement[] = [...withEngine, { partInstanceId: 'p', gx: 0, gy: 0, rot: 0 }];
    const violations = directionViolations(after, byId);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.partInstanceId).toBe('e');
    expect(violations[0]?.blockers.has('p')).toBe(true);
    // the engine can be dropped anywhere too, in any facing
    const behind: Placement[] = [{ partInstanceId: 'p', gx: 0, gy: 0, rot: 0 }];
    expect(placementIssue(behind, byId, 'e', 1, 0, 0, cells)).toBeNull();
  });
});
