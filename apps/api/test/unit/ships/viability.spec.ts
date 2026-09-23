import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { deriveSheet } from '../../../src/ships/sheet.deriver.js';
import { checkViability } from '../../../src/ships/viability.js';
import { buildInstalled } from './fixtures/catalog.js';

const rules = GAME_CONFIG_DEFAULTS;

describe('checkViability', () => {
  it('passes for the starter kit', () => {
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
    const result = checkViability(sheet, parts, rules);
    expect(result.viable).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('passes for every tournament and upgrade build', () => {
    const builds = [
      ['bridge', 'engine_ion_micro', 'reactor_solar', 'battery_small', 'hull'],
      ['bridge', 'engine_chem_small', 'tank_small', 'cargo', 'cargo', 'cargo', 'hull'],
      ['bridge', 'engine_chem_medium', 'weapon_ballistic', 'armor_plate', 'tank_small', 'hull'],
      ['bridge', 'engine_ion_micro', 'mining_rig', 'reactor_solar', 'hull'],
      ['bridge', 'engine_chem_small', 'tank_small', 'battery_small', 'cargo', 'weapon_ballistic', 'hull'],
      ['bridge', 'engine_ion_micro', 'tank_small', 'battery_small', 'cargo', 'cargo', 'reactor_solar', 'hull'],
      ['bridge', 'engine_chem_medium', 'tank_small', 'battery_large', 'weapon_laser', 'hull'],
      ['bridge', 'engine_chem_medium', 'tank_small', 'battery_small', 'shield_basic', 'hull'],
      ['bridge', 'engine_ion_micro', 'tank_small', 'battery_small', 'sensor_radar', 'cargo', 'reactor_solar', 'hull'],
    ];
    for (const build of builds) {
      const parts = buildInstalled(build);
      const sheet = deriveSheet(parts, rules);
      const result = checkViability(sheet, parts, rules);
      expect(result.viable).toBe(true);
      expect(result.problems).toEqual([]);
    }
  });

  it('passes for the kitchen-sink build with high structure use', () => {
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
    const result = checkViability(sheet, parts, rules);
    expect(result.viable).toBe(true);
    expect(sheet.structureUsed / sheet.structureBudget).toBeGreaterThanOrEqual(0.9);
    expect(sheet.mob).toBeLessThanOrEqual(3);
  });

  it('fails with NO_BRIDGE when the bridge is missing', () => {
    const parts = buildInstalled(['engine_chem_small', 'tank_small']);
    const sheet = deriveSheet(parts, rules);
    const result = checkViability(sheet, parts, rules);
    expect(result.viable).toBe(false);
    expect(result.problems.map((p) => p.code)).toContain('NO_BRIDGE');
  });

  it('fails with NO_ENGINE when no engine is installed', () => {
    const parts = buildInstalled(['bridge', 'cargo']);
    const sheet = deriveSheet(parts, rules);
    const result = checkViability(sheet, parts, rules);
    expect(result.viable).toBe(false);
    expect(result.problems.map((p) => p.code)).toContain('NO_ENGINE');
  });

  it('fails with MOB_TOO_LOW when mobility drops below 1', () => {
    const parts = buildInstalled([
      'bridge',
      'engine_ion_micro',
      'reactor_solar',
      ...Array.from({ length: 18 }, () => 'hull'),
    ]);
    const sheet = deriveSheet(parts, rules);
    const result = checkViability(sheet, parts, rules);
    expect(result.viable).toBe(false);
    expect(result.problems.map((p) => p.code)).toContain('MOB_TOO_LOW');
  });

  it('fails with NO_FUEL_CAPACITY for a chemical engine without a tank', () => {
    const parts = buildInstalled(['bridge', 'engine_chem_small', 'battery_small']);
    const sheet = deriveSheet(parts, rules);
    const result = checkViability(sheet, parts, rules);
    expect(result.viable).toBe(false);
    expect(result.problems.map((p) => p.code)).toContain('NO_FUEL_CAPACITY');
  });

  it('fails with ENERGY_CRUISE_NEGATIVE when continuous draw exceeds generation', () => {
    const parts = buildInstalled(['bridge', 'sensor_radar', 'sensor_radar', 'sensor_radar', 'sensor_radar', 'sensor_radar']);
    const sheet = deriveSheet(parts, rules);
    const result = checkViability(sheet, parts, rules);
    expect(result.viable).toBe(false);
    expect(result.problems.map((p) => p.code)).toContain('ENERGY_CRUISE_NEGATIVE');
  });

  it('fails with BATTERY_OUTPUT_INSUFFICIENT when combat drain exceeds battery output', () => {
    const parts = buildInstalled(['bridge', 'weapon_laser']);
    const sheet = deriveSheet(parts, rules);
    const result = checkViability(sheet, parts, rules);
    expect(result.viable).toBe(false);
    expect(result.problems.map((p) => p.code)).toContain('BATTERY_OUTPUT_INSUFFICIENT');
  });

  it('fails with STRUCTURE_EXCEEDED when parts exceed the structure budget', () => {
    const parts = buildInstalled([
      'bridge',
      'engine_chem_large',
      'engine_chem_large',
      'engine_chem_large',
      'armor_plate',
      'armor_plate',
      'armor_plate',
      'weapon_missile',
    ]);
    const sheet = deriveSheet(parts, rules);
    const result = checkViability(sheet, parts, rules);
    expect(result.viable).toBe(false);
    expect(result.problems.map((p) => p.code)).toContain('STRUCTURE_EXCEEDED');
  });
});
