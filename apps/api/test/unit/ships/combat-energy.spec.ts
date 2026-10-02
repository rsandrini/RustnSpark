import { describe, expect, it } from '@jest/globals';
import { combatEnergyDraw } from '../../../src/ships/combat-energy.js';
import type { InstalledPart } from '../../../src/parts/part.types.js';

function part(overrides: Partial<InstalledPart> & { catalog: Partial<InstalledPart['catalog']> }): InstalledPart {
  return {
    instance: { id: 'id', partType: 'type', condition: 100 },
    catalog: {
      partType: 'type',
      displayName: { en: 'x' },
      partClass: 'WEAPON',
      rarity: 'COMMON',
      w: 1,
      h: 1,
      mass: 1,
      structureCost: 1,
      basePrice: 1,
      scrapValue: 1,
      partHp: 1,
      energyCont: 0,
      ...overrides.catalog,
    },
    ...overrides,
  } as InstalledPart;
}

describe('combatEnergyDraw', () => {
  it('sums WEAPON parts into weapon draw and DEFENSE parts with energyCombat into shield draw', () => {
    const installed: InstalledPart[] = [
      part({ catalog: { partClass: 'WEAPON', energyCombat: -5 } }),
      part({ catalog: { partClass: 'WEAPON', energyCombat: -3 } }),
      part({ catalog: { partClass: 'DEFENSE', energyCombat: -6, esc: 10 } }),
      part({ catalog: { partClass: 'DEFENSE', energyCombat: 0, bli: 4 } }),
    ];
    expect(combatEnergyDraw(installed)).toEqual({
      weaponEnergyDraw: 8,
      shieldEnergyDraw: 6,
    });
  });

  it('treats negative and positive energyCombat as absolute draw', () => {
    const installed: InstalledPart[] = [
      part({ catalog: { partClass: 'WEAPON', energyCombat: -4 } }),
      part({ catalog: { partClass: 'DEFENSE', energyCombat: -2 } }),
    ];
    expect(combatEnergyDraw(installed)).toEqual({
      weaponEnergyDraw: 4,
      shieldEnergyDraw: 2,
    });
  });

  it('returns zero when no parts draw combat energy', () => {
    const installed: InstalledPart[] = [
      part({ catalog: { partClass: 'BRIDGE', energyCombat: 0 } }),
      part({ catalog: { partClass: 'CARGO', energyCombat: 0 } }),
    ];
    expect(combatEnergyDraw(installed)).toEqual({
      weaponEnergyDraw: 0,
      shieldEnergyDraw: 0,
    });
  });
});
