import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import { shipTier } from '../../../src/ships/ship-tier.js';

// Mirror of the seeded PartCatalog base prices so tests stay deterministic.
const CATALOG: Readonly<Record<string, number>> = {
  bridge: 0,
  engine_chem_small: 100,
  engine_chem_medium: 300,
  engine_chem_large: 800,
  engine_ion_micro: 150,
  tank_small: 200,
  battery_small: 150,
  battery_large: 400,
  weapon_ballistic: 120,
  weapon_laser: 350,
  weapon_missile: 450,
  armor_plate: 500,
  hull: 100,
  shield_basic: 400,
  sensor_radar: 200,
  cargo: 80,
  mining_rig: 400,
  reactor_solar: 300,
  reactor_nuclear: 2000,
};

const STARTER_BUILD = [
  'bridge',
  'engine_chem_small',
  'tank_small',
  'battery_small',
  'cargo',
  'cargo',
  'hull',
];

// Portuguese simulator ids mapped to the English partType ids in the seed catalog.
const BUILDS_UPGRADE = {
  carga: [
    'bridge',
    'engine_chem_large',
    'tank_small',
    'battery_small',
    'cargo',
    'cargo',
    'cargo',
    'hull',
    'weapon_ballistic',
  ],
  combate: [
    'bridge',
    'engine_chem_large',
    'tank_small',
    'battery_small',
    'armor_plate',
    'weapon_laser',
    'weapon_ballistic',
    'sensor_radar',
    'hull',
  ],
  minerador: [
    'bridge',
    'engine_chem_large',
    'tank_small',
    'battery_small',
    'mining_rig',
    'cargo',
    'cargo',
    'hull',
  ],
  rapido: [
    'bridge',
    'engine_chem_large',
    'engine_chem_small',
    'tank_small',
    'battery_small',
    'weapon_ballistic',
    'weapon_ballistic',
    'hull',
    'sensor_radar',
  ],
} as const;

function parts(ids: readonly string[]): Array<{ basePrice: number }> {
  return ids.map((id) => ({ basePrice: CATALOG[id] ?? 0 }));
}

function rulesWithThresholds(thresholds: Record<string, number>): GameRules {
  return { ...GAME_CONFIG_DEFAULTS, economy: { ...GAME_CONFIG_DEFAULTS.economy, upgrade_costs: thresholds } };
}

describe('shipTier', () => {
  it('returns tier 1 for an empty parts list', () => {
    expect(shipTier([], GAME_CONFIG_DEFAULTS)).toBe(1);
  });

  it('returns tier 1 for the starter build', () => {
    expect(shipTier(parts(STARTER_BUILD), GAME_CONFIG_DEFAULTS)).toBe(1);
  });

  it('computes the exact tier for each BUILDS_UPGRADE build from catalog prices', () => {
    // carga: 0 + 800 + 200 + 150 + 80*3 + 100 + 120 = 1610 -> tier 2
    expect(shipTier(parts(BUILDS_UPGRADE.carga), GAME_CONFIG_DEFAULTS)).toBe(2);

    // combate: 0 + 800 + 200 + 150 + 500 + 350 + 120 + 200 + 100 = 2420 -> tier 3
    expect(shipTier(parts(BUILDS_UPGRADE.combate), GAME_CONFIG_DEFAULTS)).toBe(3);

    // minerador: 0 + 800 + 200 + 150 + 400 + 80 + 80 + 100 = 1810 -> tier 2
    expect(shipTier(parts(BUILDS_UPGRADE.minerador), GAME_CONFIG_DEFAULTS)).toBe(2);

    // rapido: 0 + 800 + 100 + 200 + 150 + 120 + 120 + 100 + 200 = 1790 -> tier 2
    expect(shipTier(parts(BUILDS_UPGRADE.rapido), GAME_CONFIG_DEFAULTS)).toBe(2);
  });

  it('returns tier 5 for a build whose total base value reaches the top threshold', () => {
    const tier5Build = ['bridge', ...Array.from({ length: 17 }, () => 'reactor_nuclear')];
    expect(shipTier(parts(tier5Build), GAME_CONFIG_DEFAULTS)).toBe(5);
  });

  it('respects custom thresholds from GameRules', () => {
    const custom = rulesWithThresholds({ 2: 500, 3: 1000, 4: 1500, 5: 2000 });
    expect(shipTier(parts(STARTER_BUILD), custom)).toBe(2);
  });

  it('accepts parts normalized from nested partCatalog data', () => {
    const instances = parts(STARTER_BUILD).map((p) => ({ partCatalog: { basePrice: p.basePrice } }));
    // Callers normalize nested catalog data to the unified { basePrice } shape.
    const normalized = instances.map((i) => ({ basePrice: i.partCatalog.basePrice }));
    expect(shipTier(normalized, GAME_CONFIG_DEFAULTS)).toBe(1);
  });
});
