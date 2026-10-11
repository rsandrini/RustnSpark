import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { buildRules } from '../../../sim/snapshot/export-snapshot.js';
import {
  SnapshotFormatError,
  assertSnapshotShape,
  parseSnapshot,
  setRule,
  withEdits,
} from '../../../sim/snapshot/load-snapshot.js';
import type { Snapshot } from '../../../sim/snapshot/types.js';

const BASE_CATALOG_ROW = {
  partType: 'bridge',
  partClass: 'BRIDGE',
  rarity: 'COMMON',
  w: 2,
  h: 2,
  mass: 10,
  structureCost: 10,
  basePrice: 400,
  scrapValue: 100,
  partHp: 60,
  pot: 0,
  pdf: 0,
  bli: 0,
  esc: 0,
  sen: 2,
  crg: 2,
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
} as const;

function fixtureSnapshot(): Snapshot {
  return {
    takenAt: '2026-10-11T00:00:00.000Z',
    rules: structuredClone(GAME_CONFIG_DEFAULTS),
    catalog: [{ ...BASE_CATALOG_ROW }],
    locations: [
      {
        id: 'ceres',
        displayName: { en: 'Ceres' },
        description: { en: '' },
        type: 'HUB',
        x: 0,
        y: 0,
        zone: 1,
        factionId: 'luna',
        isolation: 1,
        mood: 1,
        services: {},
      },
    ],
    routes: [],
    routeEnvironments: [],
    environments: [],
    templates: [],
    materials: [],
    dropTable: [],
    factions: [{ id: 'luna', playable: true, relations: {} }],
  };
}

describe('snapshot rules', () => {
  it('overlays a GameConfig row over the factory default (the game\'s own merge)', () => {
    const defaultFuel = GAME_CONFIG_DEFAULTS.economy.fuel_price;
    // Inside the Admin's own bounds (0.1–20): the merged rules go through the game's schema.
    const rules = buildRules([{ key: 'economy.fuel_price', value: 9.9 }]);

    expect(rules.economy.fuel_price).toBe(9.9);
    expect(rules.economy.fuel_price).not.toBe(defaultFuel);
    // Untouched groups still come from the defaults.
    expect(rules.combat).toEqual(GAME_CONFIG_DEFAULTS.combat);
  });

  it('refuses a key that points at a group the defaults do not have', () => {
    expect(() => buildRules([{ key: 'nowhere.value', value: 1 }])).toThrow(/missing group/);
  });
});

describe('snapshot loading', () => {
  it('rejects a file with no rules', () => {
    const broken = fixtureSnapshot() as unknown as Record<string, unknown>;
    delete broken['rules'];

    expect(() => parseSnapshot(JSON.stringify(broken))).toThrow(SnapshotFormatError);
    expect(() => parseSnapshot(JSON.stringify(broken))).toThrow(/missing "rules"/);
  });

  it('rejects rules without an economy group, and a catalog row without a partType', () => {
    const noEconomy = fixtureSnapshot() as unknown as Record<string, unknown>;
    noEconomy['rules'] = { combat: {} };
    expect(() => assertSnapshotShape(noEconomy)).toThrow(/economy/);

    const badRow = fixtureSnapshot() as unknown as Record<string, unknown>;
    badRow['catalog'] = [{ partClass: 'BRIDGE' }];
    expect(() => assertSnapshotShape(badRow)).toThrow(/partType/);
  });

  it('freezes what it hands back, so a run cannot write through it', () => {
    const snapshot = parseSnapshot(JSON.stringify(fixtureSnapshot()));

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.catalog)).toBe(true);
    expect(Object.isFrozen(snapshot.catalog[0])).toBe(true);
    expect(() => {
      (snapshot.catalog[0] as { basePrice: number }).basePrice = 1;
    }).toThrow();
  });

  it('refuses to edit an immutable original: withEdits returns a copy', () => {
    const original = parseSnapshot(JSON.stringify(fixtureSnapshot()));
    const before = structuredClone(original);

    const edited = withEdits(original, (draft) => {
      setRule(draft, 'economy.fuel_price', 9.9);
      (draft.catalog[0] as { basePrice: number }).basePrice = 1;
      draft.catalog.push({ ...BASE_CATALOG_ROW, partType: 'hull' });
    });

    expect((original.rules.economy as { fuel_price: number }).fuel_price).not.toBe(9.9);
    expect(original.catalog).toHaveLength(1);
    expect((original.catalog[0] as { basePrice: number }).basePrice).toBe(BASE_CATALOG_ROW.basePrice);
    expect(structuredClone(original)).toEqual(before);

    expect((edited.rules.economy as { fuel_price: number }).fuel_price).toBe(9.9);
    expect(edited.catalog).toHaveLength(2);
    expect(edited.catalog[0]).not.toBe(original.catalog[0]);
    expect(Object.isFrozen(edited)).toBe(true);
  });
});
