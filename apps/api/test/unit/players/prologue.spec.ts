import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import {
  GameConfigValidationError,
  validateGameRules,
} from '../../../src/config/game-rules.schema.js';
import { prologuePayouts } from '../../../src/players/prologue.js';

const SHARES = [20, 30, 50];
const PURSE = 300;
const REFUEL = 100;
const MODULE = 800;
const POOL = 3000 - PURSE + REFUEL + MODULE;
const withShares = (shares: number[]) => ({
  ...GAME_CONFIG_DEFAULTS,
  onboarding: { ...GAME_CONFIG_DEFAULTS.onboarding, prologue_payout_shares: shares },
});
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

describe('prologuePayouts', () => {
  it('splits the pool so start - purse + refuel + module is covered exactly', () => {
    const payouts = prologuePayouts(3000, PURSE, REFUEL, MODULE, SHARES);
    expect(sum(payouts)).toBe(POOL);
    expect(payouts).toEqual([720, 1080, 1800]);
  });

  it('gives the rounding remainder to the last payout', () => {
    const payouts = prologuePayouts(3001, PURSE, REFUEL, MODULE, SHARES);
    expect(sum(payouts)).toBe(3001 - PURSE + REFUEL + MODULE);
    expect(payouts).toEqual([720, 1080, 1801]);
  });

  it('returns an empty list for no shares', () => {
    expect(prologuePayouts(3000, PURSE, REFUEL, MODULE, [])).toEqual([]);
  });
});

describe('onboarding.prologue config', () => {
  it('is part of the factory defaults and validates', () => {
    expect(GAME_CONFIG_DEFAULTS.onboarding.prologue_payout_shares).toEqual(SHARES);
    expect(GAME_CONFIG_DEFAULTS.onboarding.prologue_purse).toBe(PURSE);
    expect(GAME_CONFIG_DEFAULTS.onboarding.prologue_refuel_cost).toBe(REFUEL);
    expect(GAME_CONFIG_DEFAULTS.onboarding.prologue_module_cost).toBe(MODULE);
    expect(validateGameRules(GAME_CONFIG_DEFAULTS)).toEqual(GAME_CONFIG_DEFAULTS);
  });

  it('has a refuel cost and a module cost that are whole numbers of credits', () => {
    const negativeRefuel = {
      ...GAME_CONFIG_DEFAULTS,
      onboarding: { ...GAME_CONFIG_DEFAULTS.onboarding, prologue_refuel_cost: -1 },
    };
    expect(() => validateGameRules(negativeRefuel)).toThrow(GameConfigValidationError);
    const negativeModule = {
      ...GAME_CONFIG_DEFAULTS,
      onboarding: { ...GAME_CONFIG_DEFAULTS.onboarding, prologue_module_cost: -1 },
    };
    expect(() => validateGameRules(negativeModule)).toThrow(GameConfigValidationError);
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

  it('rejects a negative purse', () => {
    const negative = {
      ...GAME_CONFIG_DEFAULTS,
      onboarding: { ...GAME_CONFIG_DEFAULTS.onboarding, prologue_purse: -1 },
    };
    expect(() => validateGameRules(negative)).toThrow(GameConfigValidationError);
  });

  it('is replayable from an older stored rule set that lacks the new keys', () => {
    const { prologue_payout_shares: _omitted, ...older } = GAME_CONFIG_DEFAULTS.onboarding;
    const rules = validateGameRules({ ...GAME_CONFIG_DEFAULTS, onboarding: older });
    expect(rules.onboarding.prologue_payout_shares).toEqual(SHARES);
    expect(rules.onboarding.prologue_purse).toBe(PURSE);
    expect(rules.onboarding.prologue_module_cost).toBe(MODULE);
  });
});
