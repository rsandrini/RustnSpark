import { describe, expect, it } from '@jest/globals';
import {
  applyConnectivity,
  conductiveCatalog,
  withConnectionProblem,
} from '../../../src/ships/connectivity.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { InstalledPart } from '../../../src/parts/part.types.js';

function part(id: string, overrides: Partial<InstalledPart['catalog']> = {}): InstalledPart {
  return {
    instance: { id, partType: 'x', condition: 100 },
    catalog: {
      partType: 'x',
      partClass: 'UTILITY',
      w: 1,
      h: 1,
      mass: 5,
      structureCost: 3,
      partHp: 10,
      basePrice: 0,
      pot: 7,
      pdf: 7,
      bli: 7,
      esc: 7,
      sen: 7,
      crg: 7,
      min: 7,
      energyCont: 7,
      energyCombat: 7,
      fuelCap: 7,
      fuelUse: 7,
      batCharge: 7,
      batOutput: 7,
      batInput: 7,
      pressurized: false,
      lifeSupport: false,
      ...overrides,
    },
  };
}

describe('applyConnectivity', () => {
  it('leaves a connected part entirely unchanged', () => {
    const p = part('a');
    const [result] = applyConnectivity([p], new Set(['a']));
    expect(result).toEqual(p);
  });

  it('zeroes every functional stat for a disconnected part, keeping mass/structureCost/partHp', () => {
    const p = part('a');
    const [result] = applyConnectivity([p], new Set()); // 'a' not in the connected set
    expect(result!.catalog.mass).toBe(5);
    expect(result!.catalog.structureCost).toBe(3);
    expect(result!.catalog.partHp).toBe(10);
    for (const key of [
      'pot',
      'pdf',
      'bli',
      'esc',
      'sen',
      'crg',
      'min',
      'energyCont',
      'energyCombat',
      'batCharge',
      'batOutput',
      'batInput',
      'fuelCap',
      'fuelUse',
    ] as const) {
      expect(result!.catalog[key]).toBe(0);
    }
  });

  it('keeps w, h, and basePrice for a disconnected part — geometry and pricing are not functional stats', () => {
    // Regression: an earlier implementation zeroed "every numeric field that isn't
    // mass/structureCost/partHp", which also zeroed w/h/basePrice. basePrice feeds
    // shipTier(), so a disconnected part could silently drop a ship's whole tier.
    const p = part('a', { w: 2, h: 3, basePrice: 500 });
    const [result] = applyConnectivity([p], new Set());
    expect(result!.catalog.w).toBe(2);
    expect(result!.catalog.h).toBe(3);
    expect(result!.catalog.basePrice).toBe(500);
  });

  it('does not mutate the input', () => {
    const p = part('a');
    applyConnectivity([p], new Set());
    expect(p.catalog.pot).toBe(7); // original object untouched
  });

  it('handles a mix of connected and disconnected parts independently', () => {
    const a = part('a');
    const b = part('b');
    const [resultA, resultB] = applyConnectivity([a, b], new Set(['a']));
    expect(resultA!.catalog.pot).toBe(7);
    expect(resultB!.catalog.pot).toBe(0);
  });
});

describe('conductiveCatalog: a broken part no longer carries a connection', () => {
  const rules = GAME_CONFIG_DEFAULTS;
  const broken = (id: string, partClass = 'DEFENSE'): InstalledPart => {
    const p = part(id, { partClass });
    return { ...p, instance: { ...p.instance, condition: 0 } };
  };

  it('leaves out the dead parts, keeps the live ones and always keeps the bridge', () => {
    const parts = [part('live'), broken('hull'), broken('bridge', 'BRIDGE')];
    const catalog = new Map(parts.map((p) => [p.instance.id, p.catalog]));
    const live = conductiveCatalog(catalog, parts, rules);
    expect([...live.keys()].sort()).toEqual(['bridge', 'live']);
    // the original map is untouched (other checks still need the dead part's data)
    expect(catalog.size).toBe(3);
  });
});

describe('withConnectionProblem: a disconnected part keeps the ship on the ground', () => {
  const ok = { viable: true, problems: [], warnings: [] };

  it('leaves a fully connected ship alone', () => {
    const parts = [part('a'), part('b')];
    expect(withConnectionProblem(ok, parts, new Set(['a', 'b']))).toBe(ok);
  });

  it('adds one blocking problem when any part is not connected, naming how many', () => {
    const parts = [part('a'), part('b'), part('c')];
    const report = withConnectionProblem(ok, parts, new Set(['a']));
    expect(report.viable).toBe(false);
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]!.code).toBe('PART_DISCONNECTED');
    expect(report.problems[0]!.message).toContain('2 installed part(s)');
  });

  it('does not repeat itself', () => {
    const parts = [part('a'), part('b')];
    const once = withConnectionProblem(ok, parts, new Set(['a']));
    expect(withConnectionProblem(once, parts, new Set(['a'])).problems).toHaveLength(1);
  });
});
