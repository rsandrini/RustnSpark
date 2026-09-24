import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import {
  buyPrice,
  conditionMultiplier,
  partValue,
  sellPrice,
  type PartPriceInput,
} from '../../../src/economy/price.calculator.js';

const rules: GameRules = GAME_CONFIG_DEFAULTS;

function input(overrides: Partial<PartPriceInput> = {}): PartPriceInput {
  return {
    basePrice: 100,
    isolation: 1,
    factionRelation: 'neutral',
    mood: 1,
    condition: 100,
    ...overrides,
  };
}

describe('S8.1 — condition multiplier', () => {
  it('is linear: 100 → 1.0, 40 → 0.4, clamps outside 0–100', () => {
    expect(conditionMultiplier(100)).toBe(1);
    expect(conditionMultiplier(40)).toBeCloseTo(0.4, 12);
    expect(conditionMultiplier(0)).toBe(0);
    expect(conditionMultiplier(-10)).toBe(0);
    expect(conditionMultiplier(150)).toBe(1);
  });
});

describe('S8.1 — part value and prices', () => {
  it('applies isolation × faction × mood × condition to the base price', () => {
    const value = partValue(
      input({
        basePrice: 100,
        isolation: 2,
        factionRelation: 'hostile',
        mood: 1.15,
        condition: 80,
      }),
      rules,
    );
    // 100 × 2 × 2.5 × 1.15 × 0.8 = 460
    expect(value).toBeCloseTo(460, 10);
    expect(buyPrice(input({ isolation: 2, factionRelation: 'hostile', mood: 1.15 }), rules)).toBe(
      575,
    );
  });

  it('sell is sell_ratio (0.6) × value', () => {
    expect(rules.economy.sell_ratio).toBe(0.6);
    // value 100 → sell 60
    expect(sellPrice(input(), rules)).toBe(60);
    // condition 50 → value 50 → sell 30
    expect(sellPrice(input({ condition: 50 }), rules)).toBe(30);
  });

  it('has no faction start discount (D27): ally is just the mult, not a bonus', () => {
    const ally = partValue(input({ factionRelation: 'ally' }), rules);
    expect(ally).toBeCloseTo(80, 10);
    expect(rules.economy.faction_mult).toEqual({ ally: 0.8, neutral: 1.0, hostile: 2.5 });
  });

  it('hub (0.9 ally) vs hostile outpost (2.0 hostile) spreads ≈6× at mood 1', () => {
    const hub = partValue(input({ isolation: 0.9, factionRelation: 'ally', mood: 1 }), rules);
    const hostile = partValue(
      input({ isolation: 2.0, factionRelation: 'hostile', mood: 1 }),
      rules,
    );
    const ratio = hostile / hub;
    // 2.0×2.5 / (0.9×0.8) = 5 / 0.72 ≈ 6.94 — economy table ~6× within tolerance
    expect(ratio).toBeGreaterThan(5.5);
    expect(ratio).toBeLessThan(7.5);
  });

  it('pins the isolation and faction maps from the economy doc', () => {
    expect(rules.economy.isolation_mult).toEqual({ 0: 0.9, 1: 1.0, 2: 1.4, 3: 2.0 });
    expect(rules.economy.mood_min).toBe(0.85);
    expect(rules.economy.mood_max).toBe(1.15);
  });
});
