import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { ShipSheet } from '../../../src/ships/sheet.types.js';
import { deriveSheet, effectiveSheet } from '../../../src/ships/sheet.deriver.js';
import { buildInstalled } from './fixtures/catalog.js';

const rules = GAME_CONFIG_DEFAULTS;

function expectSheet(sheet: ShipSheet, expected: Partial<ShipSheet>): void {
  for (const [key, value] of Object.entries(expected)) {
    const actual = sheet[key as keyof ShipSheet];
    if (typeof value === 'number' && !Number.isInteger(value)) {
      expect(actual).toBeCloseTo(value, 3);
    } else {
      expect(actual).toBe(value);
    }
  }
}

describe('sheet.deriver', () => {
  describe('deriveSheet', () => {
    it('derives the starter build sheet', () => {
      const parts = buildInstalled([
        'bridge',
        'engine_chem_small',
        'tank_small',
        'battery_small',
        'cargo',
        'cargo',
        'hull',
      ]);
      const sheet = deriveSheet(parts, rules);
      expectSheet(sheet, {
        pot: 25,
        pdf: 0,
        bli: 1,
        esc: 0,
        sen: 0,
        crg: 10,
        min: 0,
        hp: 145,
        mass: 25,
        energyCont: 1,
        energyCombat: 0,
        batCharge: 300,
        batOutput: 80,
        batInput: 0,
        fuelCap: 1000,
        fuelUse: 0.7,
        structureUsed: 29,
        structureBudget: 100,
        autonomy: (1000 / 0.7) * 100,
        mob: 2,
        condition: 100,
      });
    });

    it('derives the tournament speed build sheet', () => {
      const parts = buildInstalled([
        'bridge',
        'engine_ion_micro',
        'reactor_solar',
        'battery_small',
        'hull',
      ]);
      const sheet = deriveSheet(parts, rules);
      expectSheet(sheet, {
        pot: 18,
        pdf: 0,
        bli: 1,
        esc: 0,
        sen: 0,
        crg: 0,
        min: 0,
        hp: 100,
        mass: 17,
        energyCont: 29,
        energyCombat: 0,
        batCharge: 300,
        batOutput: 80,
        batInput: 0,
        fuelCap: 0,
        fuelUse: 0,
        structureUsed: 19,
        structureBudget: 100,
        autonomy: 0,
        mob: 2,
        condition: 100,
      });
    });

    it('derives the tournament cargo build sheet', () => {
      const parts = buildInstalled([
        'bridge',
        'engine_chem_small',
        'tank_small',
        'cargo',
        'cargo',
        'cargo',
        'hull',
      ]);
      const sheet = deriveSheet(parts, rules);
      expectSheet(sheet, {
        pot: 25,
        pdf: 0,
        bli: 1,
        esc: 0,
        sen: 0,
        crg: 15,
        min: 0,
        hp: 140,
        mass: 22,
        energyCont: 1,
        energyCombat: 0,
        batCharge: 0,
        batOutput: 0,
        batInput: 0,
        fuelCap: 1000,
        fuelUse: 0.7,
        structureUsed: 27,
        structureBudget: 100,
        autonomy: (1000 / 0.7) * 100,
        mob: 2,
        condition: 100,
      });
    });

    it('derives the tournament combat build sheet', () => {
      const parts = buildInstalled([
        'bridge',
        'engine_chem_medium',
        'weapon_ballistic',
        'armor_plate',
        'tank_small',
        'hull',
      ]);
      const sheet = deriveSheet(parts, rules);
      expectSheet(sheet, {
        pot: 40,
        pdf: 3,
        bli: 5,
        esc: 0,
        sen: 0,
        crg: 0,
        min: 0,
        hp: 165,
        mass: 32,
        energyCont: 3,
        energyCombat: 0,
        batCharge: 0,
        batOutput: 0,
        batInput: 0,
        fuelCap: 1000,
        fuelUse: 1.2,
        structureUsed: 36,
        structureBudget: 100,
        autonomy: (1000 / 1.2) * 100,
        mob: 2,
        condition: 100,
      });
    });

    it('derives the tournament miner build sheet', () => {
      const parts = buildInstalled([
        'bridge',
        'engine_ion_micro',
        'mining_rig',
        'reactor_solar',
        'hull',
      ]);
      const sheet = deriveSheet(parts, rules);
      expectSheet(sheet, {
        pot: 18,
        pdf: 0,
        bli: 1,
        esc: 0,
        sen: 0,
        crg: 0,
        min: 1,
        hp: 105,
        mass: 20,
        energyCont: 26,
        energyCombat: 0,
        batCharge: 0,
        batOutput: 0,
        batInput: 0,
        fuelCap: 0,
        fuelUse: 0,
        structureUsed: 23,
        structureBudget: 100,
        autonomy: 0,
        mob: 1,
        condition: 100,
      });
    });

    it('derives the tournament balanced build sheet', () => {
      const parts = buildInstalled([
        'bridge',
        'engine_chem_small',
        'tank_small',
        'battery_small',
        'cargo',
        'weapon_ballistic',
        'hull',
      ]);
      const sheet = deriveSheet(parts, rules);
      expectSheet(sheet, {
        pot: 25,
        pdf: 3,
        bli: 1,
        esc: 0,
        sen: 0,
        crg: 5,
        min: 0,
        hp: 150,
        mass: 26,
        energyCont: 1,
        energyCombat: 0,
        batCharge: 300,
        batOutput: 80,
        batInput: 0,
        fuelCap: 1000,
        fuelUse: 0.7,
        structureUsed: 30,
        structureBudget: 100,
        autonomy: (1000 / 0.7) * 100,
        mob: 2,
        condition: 100,
      });
    });

    it('derives the ion upgrade build sheet', () => {
      const parts = buildInstalled([
        'bridge',
        'engine_ion_micro',
        'tank_small',
        'battery_small',
        'cargo',
        'cargo',
        'reactor_solar',
        'hull',
      ]);
      const sheet = deriveSheet(parts, rules);
      expectSheet(sheet, {
        pot: 18,
        pdf: 0,
        bli: 1,
        esc: 0,
        sen: 0,
        crg: 10,
        min: 0,
        hp: 155,
        mass: 26,
        energyCont: 29,
        energyCombat: 0,
        batCharge: 300,
        batOutput: 80,
        batInput: 0,
        fuelCap: 1000,
        fuelUse: 0,
        structureUsed: 31,
        structureBudget: 100,
        autonomy: 0,
        mob: 1,
        condition: 100,
      });
    });

    it('derives the laser upgrade build sheet', () => {
      const parts = buildInstalled([
        'bridge',
        'engine_chem_medium',
        'tank_small',
        'battery_large',
        'weapon_laser',
        'hull',
      ]);
      const sheet = deriveSheet(parts, rules);
      expectSheet(sheet, {
        pot: 40,
        pdf: 4,
        bli: 1,
        esc: 0,
        sen: 0,
        crg: 0,
        min: 0,
        hp: 162,
        mass: 37,
        energyCont: 3,
        energyCombat: -5,
        batCharge: 900,
        batOutput: 200,
        batInput: 10,
        fuelCap: 1000,
        fuelUse: 1.2,
        structureUsed: 40,
        structureBudget: 100,
        autonomy: (1000 / 1.2) * 100,
        mob: 2,
        condition: 100,
      });
    });

    it('derives the shield upgrade build sheet', () => {
      const parts = buildInstalled([
        'bridge',
        'engine_chem_medium',
        'tank_small',
        'battery_small',
        'shield_basic',
        'hull',
      ]);
      const sheet = deriveSheet(parts, rules);
      expectSheet(sheet, {
        pot: 40,
        pdf: 0,
        bli: 1,
        esc: 14,
        sen: 0,
        crg: 0,
        min: 0,
        hp: 150,
        mass: 28,
        energyCont: 3,
        energyCombat: -6,
        batCharge: 300,
        batOutput: 80,
        batInput: 0,
        fuelCap: 1000,
        fuelUse: 1.2,
        structureUsed: 32,
        structureBudget: 100,
        autonomy: (1000 / 1.2) * 100,
        mob: 2,
        condition: 100,
      });
    });

    it('derives the radar upgrade build sheet', () => {
      const parts = buildInstalled([
        'bridge',
        'engine_ion_micro',
        'tank_small',
        'battery_small',
        'sensor_radar',
        'cargo',
        'reactor_solar',
        'hull',
      ]);
      const sheet = deriveSheet(parts, rules);
      expectSheet(sheet, {
        pot: 18,
        pdf: 0,
        bli: 1,
        esc: 0,
        sen: 4,
        crg: 5,
        min: 0,
        hp: 155,
        mass: 26,
        energyCont: 27,
        energyCombat: 0,
        batCharge: 300,
        batOutput: 80,
        batInput: 0,
        fuelCap: 1000,
        fuelUse: 0,
        structureUsed: 31,
        structureBudget: 100,
        autonomy: 0,
        mob: 1,
        condition: 100,
      });
    });

    it('derives the kitchen-sink build sheet', () => {
      const parts = buildInstalled([
        'bridge',
        'engine_chem_large',
        'engine_chem_medium',
        'engine_ion_micro',
        'tank_small',
        'battery_large',
        'weapon_missile',
        'armor_plate',
        'hull',
        'shield_basic',
        'sensor_radar',
        'reactor_solar',
        'cargo',
      ]);
      const sheet = deriveSheet(parts, rules);
      expectSheet(sheet, {
        pot: 128,
        pdf: 8,
        bli: 5,
        esc: 14,
        sen: 4,
        crg: 5,
        min: 0,
        hp: 335,
        mass: 75,
        energyCont: 38,
        energyCombat: -6,
        batCharge: 900,
        batOutput: 200,
        batInput: 10,
        fuelCap: 1000,
        fuelUse: 3.7,
        structureUsed: 97,
        structureBudget: 100,
        autonomy: (1000 / 3.7) * 100,
        mob: 3,
        condition: 100,
      });
    });
  });

  describe('effectiveSheet', () => {
    it('scales hp by average performance and preserves condition', () => {
      const parts = buildInstalled(['bridge', 'engine_chem_small', 'tank_small']);
      expect(parts).toHaveLength(3);
      parts[0]!.instance.condition = 100;
      parts[1]!.instance.condition = 50;
      parts[2]!.instance.condition = 0;
      const base = deriveSheet(parts, rules);
      const effective = effectiveSheet(base, parts, rules);
      const avgCondition = (100 + 50 + 0) / 3;
      const perf = 0.5 + 0.5 * (avgCondition / 100);
      expect(effective.condition).toBe(avgCondition);
      expect(effective.hp).toBeCloseTo(base.hp * perf, 3);
      expect(effective.mob).toBe(base.mob);
    });
  });

  it('adds a full tank of fuel mass, so ship.fuel_mass_per_unit affects mass and MOB', () => {
    const parts = buildInstalled(['bridge', 'engine_chem_small', 'tank_small']);
    const base = deriveSheet(parts, rules);
    const heavier = deriveSheet(parts, {
      ...rules,
      ship: { ...rules.ship, fuel_mass_per_unit: 0.1 },
    });
    expect(heavier.mass).toBeCloseTo(base.mass + base.fuelCap * 0.1);
    expect(heavier.mob).toBeLessThanOrEqual(base.mob);
  });
});
