import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { deriveShipClass } from '../../../src/ships/ship-class.js';
import { buildInstalled } from './fixtures/catalog.js';

const rules = GAME_CONFIG_DEFAULTS;

describe('deriveShipClass', () => {
  it('classifies a heavy cargo build as HAULER', () => {
    const parts = buildInstalled([
      'bridge',
      'engine_chem_small',
      'cargo',
      'cargo',
      'cargo',
      'cargo',
      'cargo',
      'cargo',
      'cargo',
      'cargo',
      'hull',
    ]);
    expect(deriveShipClass(parts, rules)).toBe('HAULER');
  });

  it('classifies a build with enough pressurized structure as TRANSPORT', () => {
    const parts = buildInstalled([
      'bridge',
      'engine_chem_small',
      'hull',
      'hull',
      'hull',
      'hull',
    ]).map((part) =>
      part.catalog.partType === 'hull'
        ? { ...part, catalog: { ...part.catalog, pressurized: true } }
        : part,
    );
    expect(deriveShipClass(parts, rules)).toBe('TRANSPORT');
  });

  it('classifies a combat-focused build as WARSHIP', () => {
    const parts = buildInstalled([
      'bridge',
      'engine_chem_medium',
      'weapon_ballistic',
      'weapon_laser',
      'armor_plate',
      'armor_plate',
      'armor_plate',
      'hull',
    ]);
    expect(deriveShipClass(parts, rules)).toBe('WARSHIP');
  });

  it('classifies a mining build as MINER', () => {
    const parts = buildInstalled([
      'bridge',
      'engine_ion_micro',
      'mining_rig',
      'reactor_solar',
      'hull',
    ]);
    expect(deriveShipClass(parts, rules)).toBe('MINER');
  });

  it('classifies an unspecialized build as MULTIROLE', () => {
    const parts = buildInstalled([
      'bridge',
      'engine_chem_small',
      'tank_small',
      'battery_small',
      'cargo',
      'hull',
    ]);
    expect(deriveShipClass(parts, rules)).toBe('MULTIROLE');
  });

  it('applies first-match precedence: hauler beats warship', () => {
    const parts = buildInstalled([
      'bridge',
      'engine_chem_medium',
      'cargo',
      'cargo',
      'cargo',
      'cargo',
      'cargo',
      'cargo',
      'cargo',
      'cargo',
      'weapon_ballistic',
      'armor_plate',
      'hull',
    ]);
    expect(deriveShipClass(parts, rules)).toBe('HAULER');
  });

  it('judges a small ship by its own shape, not by the bridge budget', () => {
    // 6 + 4 + 4 + 4 = 18 structure fitted, 8 of it cargo (44 %): a hauler despite the 100 budget.
    expect(
      deriveShipClass(
        buildInstalled(['bridge', 'engine_chem_small', 'tank_small', 'cargo', 'cargo']),
        rules,
      ),
    ).toBe('HAULER');
    // Engine + two weapons + armor: 6 + 5 + 7 + 12 = 30 fitted, 24 of it combat (80 %).
    expect(
      deriveShipClass(
        buildInstalled([
          'bridge',
          'engine_chem_small',
          'weapon_ballistic',
          'weapon_laser',
          'armor_plate',
        ]),
        rules,
      ),
    ).toBe('WARSHIP');
  });
});
