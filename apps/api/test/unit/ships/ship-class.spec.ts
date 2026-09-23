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
});
