/**
 * A tiny self-contained snapshot for the sim's unit tests: three zone-0/1 Luna ports, one open
 * environment, one DELIVERY template and the real starter-kit catalog rows (same numbers the live
 * catalog ships). No test may read `sim-data/snapshot.json` — that file is generated and
 * git-ignored.
 */
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { CatalogRow, Snapshot } from '../../../sim/snapshot/types.js';

const TAKEN_AT = '2026-10-11T00:00:00.000Z';

function catalogRow(
  overrides: Partial<CatalogRow> & Pick<CatalogRow, 'partType' | 'partClass'>,
): CatalogRow {
  return {
    rarity: 'COMMON',
    w: 1,
    h: 1,
    mass: 1,
    structureCost: 1,
    basePrice: 100,
    scrapValue: 10,
    partHp: 10,
    pot: 0,
    pdf: 0,
    bli: 0,
    esc: 0,
    sen: 0,
    crg: 0,
    min: 0,
    energyCont: 0,
    energyCombat: 0,
    fuelCap: null,
    fuelUse: null,
    batCharge: null,
    batOutput: null,
    batInput: null,
    specialProp: null,
    active: true,
    ...overrides,
  };
}

/** The live starter kit's numbers, so the fixture ship has the real sheet. */
export const STARTER_CATALOG: CatalogRow[] = [
  catalogRow({
    partType: 'bridge',
    partClass: 'BRIDGE',
    w: 1,
    h: 1,
    mass: 4,
    structureCost: -60,
    basePrice: 0,
    partHp: 30,
  }),
  catalogRow({
    partType: 'engine_chem_small',
    partClass: 'ENGINE',
    mass: 3,
    structureCost: 6,
    basePrice: 100,
    partHp: 20,
    pot: 25,
    energyCont: 2,
    fuelUse: 7,
  }),
  catalogRow({
    partType: 'tank_small',
    partClass: 'TANK',
    mass: 5,
    structureCost: 4,
    basePrice: 200,
    partHp: 25,
    fuelCap: 300,
  }),
  catalogRow({
    partType: 'cargo',
    partClass: 'CARGO',
    mass: 2,
    structureCost: 4,
    basePrice: 80,
    partHp: 15,
    crg: 5,
  }),
  catalogRow({
    partType: 'hull',
    partClass: 'DEFENSE',
    w: 2,
    h: 1,
    mass: 4,
    structureCost: 5,
    basePrice: 100,
    partHp: 30,
  }),
  // Catalog-only: the danger tests install it, the starter ship does not fly with it. Real
  // `shield_basic` COMMON numbers from `prisma/seed-data/parts.ts` (the row that gives esc > 0).
  catalogRow({
    partType: 'shield_basic',
    partClass: 'DEFENSE',
    w: 1,
    h: 1,
    mass: 5.3,
    structureCost: 8,
    basePrice: 400,
    scrapValue: 100,
    partHp: 18,
    esc: 11,
    energyCont: -2,
    energyCombat: -7,
  }),
];

export function fixtureSnapshot(): Snapshot {
  return {
    takenAt: TAKEN_AT,
    // The fixture's catalog is the five-part kit: the game's own starter now also carries a weapon.
    rules: {
      ...structuredClone(GAME_CONFIG_DEFAULTS),
      onboarding: {
        ...GAME_CONFIG_DEFAULTS.onboarding,
        starter_parts: ['bridge', 'engine_chem_small', 'tank_small', 'cargo', 'hull'],
      },
      economy: {
        ...GAME_CONFIG_DEFAULTS.economy,
        // The fixture's catalog prices are at the old money scale (the game's are ten times larger now),
        // so the materials an upgrade asks for use the old divisors (a gap rule divides sqrt(price gap)).
        upgrade_materials: {
          COMMON: [{ material: 'scrap', mode: 'gap', k: 5 }],
          UNCOMMON: [{ material: 'rare_crystals', mode: 'gap', k: 5 }],
          RARE: [
            { material: 'core_fragment', mode: 'size', k: 5 },
            { material: 'rare_crystals', mode: 'gap', k: 6 },
          ],
          EPIC: [
            { material: 'core_fragment', mode: 'size', k: 25 },
            { material: 'rare_crystals', mode: 'gap', k: 6 },
          ],
        },
      },
    },
    catalog: STARTER_CATALOG,
    locations: [
      {
        id: 'ceres',
        displayName: { en: 'Ceres' },
        description: { en: 'Home port.' },
        type: 'port',
        x: 0,
        y: 0,
        zone: 0,
        factionId: 'luna',
        isolation: 0.9,
        mood: 1,
        services: {},
      },
      {
        id: 'tycho',
        displayName: { en: 'Tycho' },
        description: { en: 'Shipyard.' },
        type: 'shipyard',
        x: 1,
        y: 0,
        zone: 0,
        factionId: 'luna',
        isolation: 0.9,
        mood: 1,
        services: {},
      },
      {
        id: 'vesta',
        displayName: { en: 'Vesta' },
        description: { en: 'Outpost.' },
        type: 'outpost',
        x: 2,
        y: 0,
        zone: 1,
        factionId: 'luna',
        isolation: 1,
        mood: 1,
        services: {},
      },
    ],
    routes: [
      { id: 'ceres-tycho', nodeAId: 'ceres', nodeBId: 'tycho', distance: 515, danger: 2 },
      { id: 'ceres-vesta', nodeAId: 'ceres', nodeBId: 'vesta', distance: 555, danger: 2 },
      { id: 'tycho-vesta', nodeAId: 'tycho', nodeBId: 'vesta', distance: 300, danger: 1 },
    ],
    routeEnvironments: [
      { routeId: 'ceres-tycho', environmentId: 'open', order: 0 },
      { routeId: 'ceres-vesta', environmentId: 'open', order: 0 },
      { routeId: 'tycho-vesta', environmentId: 'open', order: 0 },
    ],
    environments: [
      {
        id: 'open',
        displayName: { en: 'Open Space' },
        description: { en: 'Clear void.' },
        level: 1,
        fuelMult: 1,
        subsystemTarget: 'none',
        mitigatingPart: 'none',
      },
    ],
    templates: [
      {
        id: 'delivery_luna',
        displayName: { en: 'Delivery' },
        description: { en: 'Car a crate.' },
        type: 'DELIVERY',
        factionId: 'luna',
        requirements: {},
        rewardCalc: {},
        deadlineCalc: {},
        encounterPolicy: { missionForcesFlee: true },
        active: true,
      },
    ],
    materials: [
      {
        id: 'ore_iron',
        displayName: { en: 'Iron' },
        description: { en: 'Ore.' },
        rarity: 'COMMON',
        basePrice: 10,
        fixedPrice: false,
        active: true,
      },
    ],
    dropTable: [
      {
        id: 'scavenging',
        source: 'scavenging',
        tiers: [{ tier: 'COMMON', chance: 0.5 }],
      },
    ],
    factions: [
      {
        id: 'luna',
        playable: true,
        relations: { luna: 'neutral', sun: 'neutral', explorers: 'neutral', pirates: 'hostile' },
      },
    ],
  };
}
