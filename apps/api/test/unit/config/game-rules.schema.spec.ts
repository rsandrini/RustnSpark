import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import {
  GameConfigValidationError,
  validateConfigValue,
  validateGameRules,
} from '../../../src/config/game-rules.schema.js';

describe('game rules schema', () => {
  it('validates the factory defaults', () => {
    expect(validateGameRules(GAME_CONFIG_DEFAULTS)).toEqual(GAME_CONFIG_DEFAULTS);
  });

  it('rejects an out-of-bounds scalar with the key in the issue', () => {
    const invalid = {
      ...GAME_CONFIG_DEFAULTS,
      combat: { ...GAME_CONFIG_DEFAULTS.combat, dodge_factor: 99 },
    };
    expect(() => validateGameRules(invalid)).toThrow(GameConfigValidationError);
    try {
      validateGameRules(invalid);
    } catch (error) {
      const err = error as GameConfigValidationError;
      expect(err.issues.some((issue) => issue.key === 'combat.dodge_factor')).toBe(true);
    }
  });

  it('rejects an invalid type', () => {
    const invalid = {
      ...GAME_CONFIG_DEFAULTS,
      combat: { ...GAME_CONFIG_DEFAULTS.combat, dc_base: 'ten' },
    };
    expect(() => validateGameRules(invalid)).toThrow(GameConfigValidationError);
  });

  it('rejects a missing key', () => {
    const { combat: _combat, ...rest } = GAME_CONFIG_DEFAULTS;
    void _combat;
    const incomplete = { ...rest } as unknown as typeof GAME_CONFIG_DEFAULTS;
    expect(() => validateGameRules(incomplete)).toThrow(GameConfigValidationError);
  });

  it('rejects an invalid wear.scale_mode', () => {
    const invalid = {
      ...GAME_CONFIG_DEFAULTS,
      wear: { ...GAME_CONFIG_DEFAULTS.wear, scale_mode: 'invalid' },
    };
    expect(() => validateGameRules(invalid)).toThrow(GameConfigValidationError);
  });

  it('rejects a record value out of bounds', () => {
    const invalid = {
      ...GAME_CONFIG_DEFAULTS,
      economy: { ...GAME_CONFIG_DEFAULTS.economy, isolation_mult: { 0: 99 } },
    };
    expect(() => validateGameRules(invalid)).toThrow(GameConfigValidationError);
  });

  describe('validateConfigValue', () => {
    it('validates a scalar within bounds', () => {
      expect(validateConfigValue('combat.dodge_factor', 2.5)).toBe(2.5);
    });

    it('rejects a scalar out of bounds', () => {
      expect(() => validateConfigValue('combat.dodge_factor', 99)).toThrow(
        GameConfigValidationError,
      );
    });

    it('rejects an unknown key', () => {
      expect(() => validateConfigValue('unknown.key', 1)).toThrow(GameConfigValidationError);
    });
  });
});
