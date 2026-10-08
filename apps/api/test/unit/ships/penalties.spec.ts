import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { applyPenalties } from '../../../src/ships/penalties.js';
import { deriveSheet } from '../../../src/ships/sheet.deriver.js';
import { buildInstalled } from './fixtures/catalog.js';

const rules = GAME_CONFIG_DEFAULTS;

describe('applyPenalties', () => {
  it('leaves a healthy ship untouched', () => {
    const parts = buildInstalled(['bridge', 'engine_chem_small', 'tank_small', 'hull']);
    const result = applyPenalties(parts, [], rules);
    expect(result.penalties).toEqual([]);
    expect(deriveSheet(result.parts, rules)).toEqual(deriveSheet(parts, rules));
  });

  it('a blocked engine gives no thrust, so the ship cannot move', () => {
    const parts = buildInstalled(['bridge', 'engine_chem_small', 'tank_small']);
    const engine = parts.find((part) => part.catalog.partClass === 'ENGINE')!;
    const result = applyPenalties(
      parts,
      [{ code: 'EXHAUST_BLOCKED', partInstanceId: engine.instance.id, message: 'x' }],
      rules,
    );
    expect(result.penalties).toEqual([
      { code: 'EXHAUST_BLOCKED', partInstanceIds: [engine.instance.id], kept: 0 },
    ]);
    expect(deriveSheet(result.parts, rules).pot).toBe(0);
    expect(deriveSheet(parts, rules).pot).toBeGreaterThan(0);
  });

  it('a blocked weapon does not fire', () => {
    const parts = buildInstalled(['bridge', 'engine_chem_small', 'tank_small', 'weapon_ballistic']);
    const weapon = parts.find((part) => part.catalog.partClass === 'WEAPON')!;
    const result = applyPenalties(
      parts,
      [{ code: 'FACING_BLOCKED', partInstanceId: weapon.instance.id, message: 'x' }],
      rules,
    );
    expect(deriveSheet(result.parts, rules).pdf).toBe(0);
    expect(deriveSheet(parts, rules).pdf).toBeGreaterThan(0);
  });

  it('a cruise power shortfall keeps the generated share of thrust, never below the floor', () => {
    const base = buildInstalled(['bridge', 'engine_chem_small', 'tank_small']);
    // 3 power generated against 12 used: 25% — exactly the floor.
    const parts = base.map((part, index) =>
      index === 0
        ? { ...part, catalog: { ...part.catalog, energyCont: 3 } }
        : part.catalog.partClass === 'ENGINE'
          ? { ...part, catalog: { ...part.catalog, energyCont: -12 } }
          : part,
    );
    const full = deriveSheet(parts, rules).pot;
    const result = applyPenalties(parts, [], rules);
    expect(result.penalties).toEqual([{ code: 'ENERGY_CRUISE_NEGATIVE', partInstanceIds: [], kept: 0.25 }]);
    expect(deriveSheet(result.parts, rules).pot).toBeCloseTo(full * 0.25);
    const lopsided = applyPenalties(
      parts.map((part, index) => (index === 0 ? { ...part, catalog: { ...part.catalog, energyCont: 0 } } : part)),
      [],
      rules,
    );
    expect(lopsided.penalties[0]?.kept).toBe(rules.ship.cruise_deficit_floor);
  });
});
