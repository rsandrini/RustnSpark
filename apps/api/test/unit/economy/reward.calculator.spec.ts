import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import {
  contractedMiningPayout,
  integrityMultiplier,
  integrityPayout,
  rewardBase,
} from '../../../src/economy/reward.calculator.js';

const rules: GameRules = GAME_CONFIG_DEFAULTS;

describe('S5.6 — reward base (D13)', () => {
  it('matches the D13 formula at the reference distance and zero danger', () => {
    // (200 + 1 × 120) × (1 + 0) × (1 + 0) × 1 = 320
    expect(
      rewardBase({ tier: 1, danger: 0, distance: 800, missionType: 'delivery' }, rules),
    ).toBeCloseTo(320, 12);
  });

  it('scales with tier, danger, distance and type bonus', () => {
    // (200 + 3×120) × (1 + 6/15) × (1 + (1400−800)/3000) × 1
    // = 560 × 1.4 × 1.2 = 940.8
    const base = rewardBase(
      { tier: 3, danger: 6, distance: 1400, missionType: 'transport' },
      rules,
    );
    expect(base).toBeCloseTo(940.8, 10);
  });

  it('reads the tape-life config values (rec_base 200, rec_por_tier 120)', () => {
    expect(rules.economy.reward_base).toBe(200);
    expect(rules.economy.reward_per_tier).toBe(120);
    expect(rules.economy.reward_danger_divisor).toBe(15);
    expect(rules.economy.reward_distance_ref).toBe(800);
    expect(rules.economy.reward_distance_divisor).toBe(3000);
    expect(rules.economy.reward_type_bonus).toEqual({
      delivery: 1,
      transport: 1,
      escort: 1,
      mining: 1,
      rescue: 1,
    });
  });

  it('applies reward_type_bonus by lowercase mission type', () => {
    const custom: GameRules = {
      ...rules,
      economy: {
        ...rules.economy,
        reward_type_bonus: { delivery: 1, transport: 1, escort: 1.5, mining: 1, rescue: 1 },
      },
    };
    expect(
      rewardBase({ tier: 1, danger: 0, distance: 800, missionType: 'ESCORT' }, custom),
    ).toBeCloseTo(480, 10);
    expect(
      rewardBase({ tier: 1, danger: 0, distance: 800, missionType: 'hunt' }, custom),
    ).toBeCloseTo(320, 10);
  });
});

describe('S5.6 — integrity payout (GDD §12)', () => {
  it('payout = base × integrity, linear 100→50, zero below 50', () => {
    expect(integrityPayout(1000, 100, rules)).toBeCloseTo(1000, 10);
    expect(integrityPayout(1000, 80, rules)).toBeCloseTo(800, 10);
    expect(integrityPayout(1000, 50, rules)).toBeCloseTo(500, 10);
    expect(integrityPayout(1000, 49, rules)).toBe(0);
    expect(integrityPayout(1000, 0, rules)).toBe(0);
  });

  it('multiplier matches the floor ratio in config', () => {
    expect(integrityMultiplier(100, rules)).toBe(1);
    expect(integrityMultiplier(50, rules)).toBe(0.5);
    expect(integrityMultiplier(49.9, rules)).toBe(0);
    expect(rules.economy.payout_floor_integrity).toBe(0.5);
  });

  it('mining is exempt: contracted pays the fixed base only when settled', () => {
    expect(contractedMiningPayout(500, true)).toBe(500);
    expect(contractedMiningPayout(500, false)).toBe(0);
  });
});
