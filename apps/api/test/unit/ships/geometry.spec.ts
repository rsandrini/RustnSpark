import { describe, expect, it } from '@jest/globals';
import { cellKey, validateLayout } from '../../../src/ships/geometry.js';
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
        basePrice: 0,
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
        pressurized: false,
        lifeSupport: false,
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
        basePrice: 0,
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
        pressurized: false,
        lifeSupport: false,
      },
    ],
  ]);

  // Reproduces the exact old GRID_HALF_SIZE=10 bound every one of these 6 tests was written
  // against — in particular "rejects parts placed out of bounds" needs x=15/16 to actually be
  // outside this set, so a wider square (e.g. [-20,20)) would silently make that test's
  // placements fit and break the assertion. None of the other 5 tests need anything beyond
  // +/-10 either.
  function wideSquareCells(): Set<string> {
    const cells = new Set<string>();
    for (let y = -10; y < 10; y += 1) {
      for (let x = -10; x < 10; x += 1) {
        cells.add(cellKey(x, y));
      }
    }
    return cells;
  }
  const cells = wideSquareCells();

  it('accepts a valid connected layout', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 1, gy: 0, rot: 0 },
    ];
    expect(validateLayout(placements, catalog, cells)).toEqual([]);
  });

  it('rejects overlapping parts', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 0, gy: 0, rot: 0 },
    ];
    const errors = validateLayout(placements, catalog, cells);
    expect(errors.map((e) => e.code)).toContain('OVERLAP');
  });

  it('rejects disconnected parts', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 5, gy: 5, rot: 0 },
    ];
    const errors = validateLayout(placements, catalog, cells);
    expect(errors.map((e) => e.code)).toContain('DISCONNECTED');
  });

  it('rejects parts placed out of bounds', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 15, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 16, gy: 0, rot: 0 },
    ];
    const errors = validateLayout(placements, catalog, cells);
    expect(errors.map((e) => e.code)).toContain('OUT_OF_BOUNDS');
  });

  it('supports 90-degree rotation swapping dimensions', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 0, gy: -2, rot: 90 },
    ];
    expect(validateLayout(placements, catalog, cells)).toEqual([]);
  });

  it('detects overlap caused by rotation', () => {
    const placements: Placement[] = [
      { partInstanceId: 'bridge', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'hull', gx: 0, gy: 0, rot: 90 },
    ];
    const errors = validateLayout(placements, catalog, cells);
    expect(errors.map((e) => e.code)).toContain('OVERLAP');
  });
});

describe('validateLayout — format cell bounds', () => {
  const bridgeOnly: ReadonlyMap<string, PartCatalog> = new Map([
    [
      'p-bridge',
      {
        partType: 'bridge',
        partClass: 'BRIDGE',
        w: 1,
        h: 1,
        mass: 1,
        structureCost: 10,
        partHp: 10,
        basePrice: 0,
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
        pressurized: false,
        lifeSupport: false,
      },
    ],
  ]);
  // A small cross: (0,0) is the bridge's own cell, plus the four neighbors.
  const CROSS_CELLS = new Set(['0,0', '1,0', '-1,0', '0,1', '0,-1']);

  it('accepts a part inside the format shape', () => {
    const placements: Placement[] = [{ partInstanceId: 'p-bridge', gx: 0, gy: 0, rot: 0 }];
    expect(validateLayout(placements, bridgeOnly, CROSS_CELLS)).toEqual([]);
  });

  it('rejects a cell outside the format shape, even though it would fit a plain square', () => {
    // (1,1) is inside a 20x20 square but NOT one of the cross's cells.
    const placements: Placement[] = [{ partInstanceId: 'p-bridge', gx: 1, gy: 1, rot: 0 }];
    const errors = validateLayout(placements, bridgeOnly, CROSS_CELLS);
    expect(errors).toEqual([
      { code: 'OUT_OF_BOUNDS', partInstanceId: 'p-bridge', message: expect.any(String) },
    ]);
  });

  it('accepts every arm of the cross', () => {
    for (const [gx, gy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const placements: Placement[] = [{ partInstanceId: 'p-bridge', gx, gy, rot: 0 }];
      expect(validateLayout(placements, bridgeOnly, CROSS_CELLS)).toEqual([]);
    }
  });
});

describe('cellKey', () => {
  it('matches the key format used to build a format cell set', () => {
    expect(cellKey(3, -2)).toBe('3,-2');
  });
});
