import { describe, expect, it } from '@jest/globals';
import { APPENDIX_E_RULES as GAME_CONFIG_DEFAULTS } from '../../fixtures/appendix-e-rules.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import {
  bridgeRarityOf,
  bridgeRewardMultiplier,
  contractedMiningPayout,
  integrityMultiplier,
  integrityPayout,
  rewardBase,
} from '../../../src/economy/reward.calculator.js';

const rules: GameRules = GAME_CONFIG_DEFAULTS;

describe('S5.6 — reward base (D13)', () => {
  it('a pilot-requested trip pays nothing, whatever the distance and danger', () => {
    expect(rewardBase({ tier: 3, danger: 9, distance: 5000, missionType: 'TRAVEL' }, rules)).toBe(
      0,
    );
    expect(rewardBase({ tier: 3, danger: 9, distance: 5000, missionType: 'travel' }, rules)).toBe(
      0,
    );
  });

  it('matches the D13 formula at the reference distance and zero danger', () => {
    // (200 + 1 × 120) × (1 + 0) × (1 + 0) × 1 = 320
    expect(
      rewardBase({ tier: 1, danger: 0, distance: 800, missionType: 'delivery' }, rules),
    ).toBeCloseTo(320, 12);
  });

  it('a hop of seconds (under the short-trip exemption) pays only a share of the usual reward', () => {
    const usual = rewardBase({ tier: 1, danger: 0, distance: 800, missionType: 'delivery' }, rules);
    const hop = { tier: 1, danger: 0, distance: 30, missionType: 'delivery' } as const;
    const withoutRule = {
      ...rules,
      missions: { ...rules.missions, short_trip_reward_factor: 1 },
    };
    const full = rewardBase(hop, withoutRule);
    expect(rewardBase(hop, rules)).toBeCloseTo(full * rules.missions.short_trip_reward_factor, 9);
    expect(rewardBase(hop, rules)).toBeLessThan(usual);
    // a trip at the threshold is an ordinary one
    const atThreshold = { ...hop, distance: rules.missions.short_trip_exempt_below };
    expect(rewardBase(atThreshold, rules)).toBeCloseTo(rewardBase(atThreshold, withoutRule), 9);
  });

  it('scales with tier, danger, distance and type bonus', () => {
    // (200 + 3×120) × (1 + 6/8) × (1 + (1400−800)/1500) × 1
    // = 560 × 1.75 × 1.4 = 1372
    const base = rewardBase(
      { tier: 3, danger: 6, distance: 1400, missionType: 'transport' },
      rules,
    );
    expect(base).toBeCloseTo(1372, 10);
  });

  it('reads the tape-life config values (rec_base 200, rec_por_tier 120)', () => {
    expect(rules.economy.reward_base).toBe(200);
    expect(rules.economy.reward_per_tier).toBe(120);
    expect(rules.economy.reward_danger_divisor).toBe(8);
    expect(rules.economy.reward_distance_ref).toBe(800);
    expect(rules.economy.reward_distance_divisor).toBe(1500);
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

describe('P3 — reward follows the bridge rarity (the part-price ladder)', () => {
  const ladder: GameRules = {
    ...rules,
    economy: {
      ...rules.economy,
      reward_by_bridge: { COMMON: 1, UNCOMMON: 1, RARE: 1.4, EPIC: 2.2, LEGENDARY: 3.2 },
    },
  };
  const trip = { tier: 3, danger: 5, distance: 1200, missionType: 'delivery' } as const;

  it('pays the table entry of the bridge rarity on top of the D13 formula', () => {
    const plain = rewardBase(trip, ladder);
    expect(rewardBase({ ...trip, bridgeRarity: 'COMMON' }, ladder)).toBeCloseTo(plain, 12);
    expect(rewardBase({ ...trip, bridgeRarity: 'RARE' }, ladder)).toBeCloseTo(plain * 1.4, 12);
    expect(rewardBase({ ...trip, bridgeRarity: 'LEGENDARY' }, ladder)).toBeCloseTo(plain * 3.2, 12);
  });

  it('is x1 with no bridge, an unknown rarity or an empty table (older rule sets replay unchanged)', () => {
    const plain = rewardBase(trip, rules);
    expect(bridgeRewardMultiplier(undefined, ladder)).toBe(1);
    expect(bridgeRewardMultiplier('MYTHIC', ladder)).toBe(1);
    expect(rewardBase({ ...trip, bridgeRarity: 'EPIC' }, rules)).toBeCloseTo(plain, 12);
  });

  it('reads the rarity of the BRIDGE among the ship parts', () => {
    expect(
      bridgeRarityOf([
        { partClass: 'ENGINE', rarity: 'LEGENDARY' },
        { partClass: 'BRIDGE', rarity: 'EPIC' },
      ]),
    ).toBe('EPIC');
    expect(bridgeRarityOf([{ partClass: 'ENGINE', rarity: 'RARE' }])).toBeUndefined();
  });
});
