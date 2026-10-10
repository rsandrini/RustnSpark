import { describe, expect, it } from '@jest/globals';
import { combatEnergyDraw, pierceShare } from '../../../src/ships/combat-energy.js';
import type { InstalledPart, PartCatalog } from '../../../src/parts/part.types.js';

function baseCatalog(): PartCatalog {
  return {
    partType: 'type',
    partClass: 'WEAPON',
    w: 1,
    h: 1,
    mass: 1,
    structureCost: 1,
    partHp: 1,
    basePrice: 1,
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
  };
}

function part(overrides: { catalog?: Partial<PartCatalog> } = {}): InstalledPart {
  return {
    instance: { id: 'id', partType: 'type', condition: 100 },
    catalog: { ...baseCatalog(), ...overrides.catalog },
  };
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

describe('pierceShare', () => {
  it('is the pdf-weighted share of armor-piercing weapons, 0 with none', () => {
    expect(pierceShare([])).toBe(0);
    expect(pierceShare([part({ catalog: { pdf: 4 } })])).toBe(0);
    expect(pierceShare([part({ catalog: { pdf: 4, armorPiercing: true } })])).toBe(1);
    expect(
      pierceShare([
        part({ catalog: { pdf: 6, armorPiercing: true } }),
        part({ catalog: { pdf: 2 } }),
        part({ catalog: { partClass: 'DEFENSE', pdf: 9 } }),
      ]),
    ).toBeCloseTo(0.75, 10);
  });
});
