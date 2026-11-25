import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { passengerPayFactor } from '../../../src/economy/reward.calculator.js';
import { missionReward } from '../../../src/missions/mission.reward.js';

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
