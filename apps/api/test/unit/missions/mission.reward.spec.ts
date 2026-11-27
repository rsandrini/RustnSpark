import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { passengerPayFactor, rewardBase } from '../../../src/economy/reward.calculator.js';
import { exploreAreaPay, missionReward } from '../../../src/missions/mission.reward.js';

const rules = GAME_CONFIG_DEFAULTS;
const legs = [{ distance: 600, danger: 1 }] as never;

describe('missionReward with a passenger head count (board and accept path)', () => {
  const figure = (type: 'TRANSPORT' | 'DELIVERY', cargo: unknown) =>
    missionReward({ legs, type, cargo: cargo as never }, 1, rules);

  it('equals the group-of-one figure times the factor, within rounding', () => {
    const one = figure('TRANSPORT', { passengers: 1 });
    const five = figure('TRANSPORT', { passengers: 5 });
    expect(five).toBeGreaterThan(one);
    expect(Math.abs(five - one * passengerPayFactor(5, rules))).toBeLessThanOrEqual(1);
    expect(figure('TRANSPORT', {})).toBe(one);
  });

  it('a non-integer head count counts as one, like the requirement check', () => {
    expect(figure('TRANSPORT', { passengers: 2.5 })).toBe(figure('TRANSPORT', { passengers: 1 }));
  });

  it('does not touch other types', () => {
    expect(figure('DELIVERY', { passengers: 5 })).toBe(figure('DELIVERY', {}));
  });
});

describe('EXPLORE pay follows the area asked for', () => {
  it('missionReward of an explore row = rewardBase + area x unit_pay', () => {
    const got = missionReward({ legs, type: 'EXPLORE', cargo: { area: 80 } }, 2, rules);
    const base = rewardBase({ tier: 2, danger: 1, distance: 600, missionType: 'EXPLORE' }, rules);
    expect(exploreAreaPay(80, rules)).toBe(80 * rules.explore.unit_pay);
    expect(got).toBe(Math.round(base + 4000));
  });

  it('a row with no area pays the base only', () => {
    const got = missionReward({ legs, type: 'EXPLORE', cargo: {} }, 2, rules);
    const base = rewardBase({ tier: 2, danger: 1, distance: 600, missionType: 'EXPLORE' }, rules);
    expect(got).toBe(Math.round(base));
  });
});

describe('EXPLORE type bonus', () => {
  it('applies to the base only, not to the area pay', () => {
    const bonus = {
      ...rules,
      economy: {
        ...rules.economy,
        reward_type_bonus: { ...rules.economy.reward_type_bonus, explore: 2 },
      },
    };
    const got = missionReward({ legs, type: 'EXPLORE', cargo: { area: 80 } }, 2, bonus);
    const base = rewardBase({ tier: 2, danger: 1, distance: 600, missionType: 'EXPLORE' }, bonus);
    const plain = rewardBase({ tier: 2, danger: 1, distance: 600, missionType: 'EXPLORE' }, rules);
    expect(base).toBeCloseTo((plain * 2) / rules.economy.reward_type_bonus.explore!, 5);
    expect(got).toBe(Math.round(base + 80 * rules.explore.unit_pay));
  });
});
