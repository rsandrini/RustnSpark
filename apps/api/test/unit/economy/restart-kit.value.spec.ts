import { describe, expect, it } from '@jest/globals';
import type { GameRules } from '../../../src/config/game-config.types.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { worstCaseRestartKitValue } from '../../../src/economy/restart-kit.value.js';

// Base prices from prisma/seed-data/parts.ts — the same rows PartCatalog is seeded with.
// The test pins them so a catalog price change that reopens the rescue loop fails here.
const STARTER_KIT_BASE_PRICES: Record<string, number> = {
  bridge: 0,
  engine_chem_small: 100,
  tank_small: 200,
  battery_small: 150,
  cargo: 80,
  hull: 100,
};

function basePriceOf(partType: string): number {
  return STARTER_KIT_BASE_PRICES[partType] ?? 0;
}

function rulesWith(overrides: Partial<GameRules['parts']>): GameRules {
  return { ...GAME_CONFIG_DEFAULTS, parts: { ...GAME_CONFIG_DEFAULTS.parts, ...overrides } };
}

describe('S8.6 restart-kit invariant (review item 4)', () => {
  it('sells for strictly less than rescue_cost under the default config', () => {
    const rules = GAME_CONFIG_DEFAULTS;
    const value = worstCaseRestartKitValue(rules, basePriceOf);
    expect(value).toBe(737);
    expect(value).toBeLessThan(rules.economy.rescue_cost);
  });

  it('would not hold at the old default of 50 — why restart_condition_max is 30', () => {
    const rules = rulesWith({ restart_condition_max: 50 });
    const value = worstCaseRestartKitValue(rules, basePriceOf);
    expect(value).toBe(1227);
    expect(value).toBeGreaterThanOrEqual(rules.economy.rescue_cost);
  });

  it('holds at every condition up to the factory default', () => {
    const rules = GAME_CONFIG_DEFAULTS;
    const defaultCondition = rules.parts.restart_condition_max;
    for (let condition = 0; condition <= defaultCondition; condition += 1) {
      expect(
        worstCaseRestartKitValue(rulesWith({ restart_condition_max: condition }), basePriceOf),
      ).toBeLessThan(rules.economy.rescue_cost);
    }
  });

  it('accounts for rescue_cost: lowering it below the kit value must be visible as a violation', () => {
    const rules: GameRules = {
      ...GAME_CONFIG_DEFAULTS,
      economy: { ...GAME_CONFIG_DEFAULTS.economy, rescue_cost: 700 },
    };
    expect(worstCaseRestartKitValue(rules, basePriceOf)).toBeGreaterThanOrEqual(
      rules.economy.rescue_cost,
    );
  });
});
