import { describe, expect, it } from 'vitest';
import { canPlace } from './hangar.geometry';
import type { PartCatalogStats } from '../../api/generated';

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
