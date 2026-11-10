import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import {
  GameConfigValidationError,
  validateGameRules,
} from '../../../src/config/game-rules.schema.js';
import { prologuePayouts } from '../../../src/players/prologue.js';

const SHARES = [20, 30, 50];
const withShares = (shares: number[]) => ({
  ...GAME_CONFIG_DEFAULTS,
  onboarding: { ...GAME_CONFIG_DEFAULTS.onboarding, prologue_payout_shares: shares },
});
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

describe('prologuePayouts', () => {
  it.each([3000, 3001, 1])('sums to exactly the start credits for %i', (startCredits) => {
    expect(sum(prologuePayouts(startCredits, SHARES))).toBe(startCredits);
  });

  it('splits 3000 as 600, 900 and 1500 with shares 20, 30 and 50', () => {
    expect(prologuePayouts(3000, SHARES)).toEqual([600, 900, 1500]);
  });

  it('gives the rounding remainder to the last payout', () => {
    expect(prologuePayouts(3001, SHARES)).toEqual([600, 900, 1501]);
  });
});

describe('onboarding.prologue_payout_shares', () => {
  it('is part of the factory defaults and validates', () => {
    expect(GAME_CONFIG_DEFAULTS.onboarding.prologue_payout_shares).toEqual(SHARES);
    expect(validateGameRules(GAME_CONFIG_DEFAULTS)).toEqual(GAME_CONFIG_DEFAULTS);
  });

  it('rejects shares that do not sum to 100', () => {
    expect(() => validateGameRules(withShares([20, 30, 40]))).toThrow(GameConfigValidationError);
  });

  it('rejects a list that is not three shares', () => {
    expect(() => validateGameRules(withShares([50, 50]))).toThrow(GameConfigValidationError);
  });

  it('rejects a negative share', () => {
    expect(() => validateGameRules(withShares([-10, 60, 50]))).toThrow(GameConfigValidationError);
  });

  it('is replayable from an older stored rule set that lacks the key', () => {
    const { prologue_payout_shares: _omitted, ...older } = GAME_CONFIG_DEFAULTS.onboarding;
    const rules = validateGameRules({ ...GAME_CONFIG_DEFAULTS, onboarding: older });
    expect(rules.onboarding.prologue_payout_shares).toEqual(SHARES);
  });
});
