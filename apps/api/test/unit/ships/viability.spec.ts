import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { deriveSheet } from '../../../src/ships/sheet.deriver.js';
import { checkViability } from '../../../src/ships/viability.js';
import { buildInstalled, CATALOG_BY_TYPE } from './fixtures/catalog.js';

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
      [
        'bridge',
        'engine_chem_small',
        'tank_small',
        'battery_small',
        'cargo',
        'weapon_ballistic',
        'hull',
      ],
      [
        'bridge',
        'engine_ion_micro',
        'tank_small',
        'battery_small',
        'cargo',
        'cargo',
        'reactor_solar',
        'hull',
      ],
      ['bridge', 'engine_chem_medium', 'tank_small', 'battery_large', 'weapon_laser', 'hull'],
      ['bridge', 'engine_chem_medium', 'tank_small', 'battery_small', 'shield_basic', 'hull'],
      [
        'bridge',
        'engine_ion_micro',
        'tank_small',
        'battery_small',
        'sensor_radar',
        'cargo',
        'reactor_solar',
        'hull',
      ],
    ];
    for (const build of builds) {
      const parts = buildInstalled(build);
      const sheet = deriveSheet(parts, rules);
      const result = checkViability(sheet, parts, rules);
      expect(result.viable).toBe(true);
      expect(result.problems).toEqual([]);
    }
  });

  it('keeps the kitchen-sink build viable but heaviest, slowest and nearly out of structure (GDD §7)', () => {
    const oracleBuilds = [
      ['bridge', 'engine_ion_micro', 'reactor_solar', 'battery_small', 'hull'],
      ['bridge', 'engine_chem_small', 'tank_small', 'cargo', 'cargo', 'cargo', 'hull'],
      ['bridge', 'engine_chem_medium', 'weapon_ballistic', 'armor_plate', 'tank_small', 'hull'],
      ['bridge', 'engine_ion_micro', 'mining_rig', 'reactor_solar', 'hull'],
      ['bridge', 'engine_chem_medium', 'tank_small', 'battery_large', 'weapon_laser', 'hull'],
      ['bridge', 'engine_chem_medium', 'tank_small', 'battery_small', 'shield_basic', 'hull'],
    ];
    const kitchenSink = buildInstalled([
      'bridge',
      'engine_chem_large',
      'tank_small',
      'battery_large',
      'weapon_missile',
      'weapon_laser',
      'armor_plate',
      'shield_basic',
      'sensor_radar',
      'reactor_solar',
      'cargo',
      'cargo',
      'cargo',
      'hull',
    ]);
    const sink = deriveSheet(kitchenSink, rules);
    expect(checkViability(sink, kitchenSink, rules).problems).toEqual([]);
    expect(sink.structureUsed / sink.structureBudget).toBeGreaterThanOrEqual(0.9);

    for (const build of oracleBuilds) {
      const other = deriveSheet(buildInstalled(build), rules);
      expect(sink.mass).toBeGreaterThan(other.mass);
      expect(sink.mob).toBeLessThanOrEqual(other.mob);
    }
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

  it('warns (does not block) ENERGY_CRUISE_NEGATIVE when continuous draw exceeds generation', () => {
    const parts = buildInstalled([
      'bridge',
      'sensor_radar',
      'sensor_radar',
      'sensor_radar',
      'sensor_radar',
      'sensor_radar',
    ]);
    const sheet = deriveSheet(parts, rules);
    const result = checkViability(sheet, parts, rules);
    expect(result.warnings.map((p) => p.code)).toContain('ENERGY_CRUISE_NEGATIVE');
    expect(result.problems.map((p) => p.code)).not.toContain('ENERGY_CRUISE_NEGATIVE');
  });

  it('warns BATTERY_OUTPUT_INSUFFICIENT when combat drain exceeds battery output', () => {
    const parts = buildInstalled(['bridge', 'engine_chem_small', 'tank_small', 'weapon_laser']);
    const sheet = deriveSheet(parts, rules);
    const result = checkViability(sheet, parts, rules);
    expect(result.warnings.map((p) => p.code)).toEqual([
      'BATTERY_OUTPUT_INSUFFICIENT',
      'BATTERY_CHARGE_INSUFFICIENT',
    ]);
    expect(result.problems.map((p) => p.code)).not.toContain('BATTERY_OUTPUT_INSUFFICIENT');
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

  it('warns BATTERY_CHARGE_INSUFFICIENT when combat drain exceeds battery charge', () => {
    const base = buildInstalled(['bridge', 'battery_small', 'weapon_laser']);
    const battery = { ...CATALOG_BY_TYPE.get('battery_small')!, batCharge: 1, batOutput: 1000 };
    const parts = base.map((part) =>
      part.catalog.partType === 'battery_small' ? { ...part, catalog: battery } : part,
    );
    const sheet = deriveSheet(parts, rules);
    const result = checkViability(sheet, parts, rules);
    expect(result.warnings.map((p) => p.code)).toContain('BATTERY_CHARGE_INSUFFICIENT');
    expect(result.warnings.map((p) => p.code)).not.toContain('BATTERY_OUTPUT_INSUFFICIENT');
  });

  it('warns NO_LIFE_SUPPORT when a pressurized part has no life support part', () => {
    const base = buildInstalled(['bridge', 'cargo']);
    const pressurized = base.map((part) =>
      part.catalog.partType === 'cargo'
        ? { ...part, catalog: { ...part.catalog, pressurized: true } }
        : part,
    );
    const sheet = deriveSheet(pressurized, rules);
    const result = checkViability(sheet, pressurized, rules);
    expect(result.warnings.map((p) => p.code)).toContain('NO_LIFE_SUPPORT');
  });

  it('does not report NO_LIFE_SUPPORT when a life support part is installed', () => {
    const base = buildInstalled(['bridge', 'cargo', 'sensor_radar']);
    const parts = base.map((part) => {
      if (part.catalog.partType === 'cargo')
        return { ...part, catalog: { ...part.catalog, pressurized: true } };
      if (part.catalog.partType === 'sensor_radar')
        return { ...part, catalog: { ...part.catalog, lifeSupport: true } };
      return part;
    });
    const sheet = deriveSheet(parts, rules);
    const result = checkViability(sheet, parts, rules);
    expect(result.problems.map((p) => p.code)).not.toContain('NO_LIFE_SUPPORT');
  });

  it('does not require a fuel tank for an ion-only build', () => {
    const parts = buildInstalled(['bridge', 'engine_ion_micro', 'reactor_solar']);
    const sheet = deriveSheet(parts, rules);
    const result = checkViability(sheet, parts, rules);
    expect(result.problems.map((p) => p.code)).not.toContain('NO_FUEL_CAPACITY');
  });
});
