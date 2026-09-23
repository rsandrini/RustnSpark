import { describe, expect, it } from '@jest/globals';
import { validateLayout } from '../../../src/ships/geometry.js';
import type { PartCatalog, Placement } from '../../../src/parts/part.types.js';

describe('validateLayout', () => {
  const catalog: ReadonlyMap<string, PartCatalog> = new Map([
    [
      'bridge',
      {
        partType: 'bridge',
        partClass: 'BRIDGE',
        w: 1,
        h: 1,
        mass: 0,
        structureCost: 0,
        partHp: 0,
        pot: 0,
        pdf: 0,
        bli: 0,
        esc: 0,
        sen: 0,
        crg: 0,
        min: 0,
        energyCont: 0,
        energyCombat: 0,
        fuelCap: 0,
        fuelUse: 0,
        batCharge: 0,
        batOutput: 0,
        batInput: 0,
      },
    ],
    [
      'hull',
      {
        partType: 'hull',
        partClass: 'DEFENSE',
        w: 2,
        h: 1,
        mass: 0,
        structureCost: 0,
        partHp: 0,
        pot: 0,
        pdf: 0,
        bli: 0,
        esc: 0,
        sen: 0,
        crg: 0,
        min: 0,
        energyCont: 0,
        energyCombat: 0,
        fuelCap: 0,
        fuelUse: 0,
        batCharge: 0,
        batOutput: 0,
        batInput: 0,
      },
    ],
  ]);

  it('accepts a valid connected layout', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 1, gy: 0, rot: 0 },
    ];
    expect(validateLayout(placements, catalog)).toEqual([]);
  });

  it('rejects overlapping parts', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 0, gy: 0, rot: 0 },
    ];
    const errors = validateLayout(placements, catalog);
    expect(errors.map((e) => e.code)).toContain('OVERLAP');
  });

  it('rejects disconnected parts', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 5, gy: 5, rot: 0 },
    ];
    const errors = validateLayout(placements, catalog);
    expect(errors.map((e) => e.code)).toContain('DISCONNECTED');
  });

  it('rejects parts placed out of bounds', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 15, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 16, gy: 0, rot: 0 },
    ];
    const errors = validateLayout(placements, catalog);
    expect(errors.map((e) => e.code)).toContain('OUT_OF_BOUNDS');
  });

  it('supports 90-degree rotation swapping dimensions', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 0, gy: -2, rot: 90 },
    ];
    expect(validateLayout(placements, catalog)).toEqual([]);
  });

  it('detects overlap caused by rotation', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 0, gy: 0, rot: 90 },
    ];
    const errors = validateLayout(placements, catalog);
    expect(errors.map((e) => e.code)).toContain('OVERLAP');
  });
});
