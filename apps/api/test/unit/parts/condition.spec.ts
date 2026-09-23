import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { chokeChance, isDead, performance } from '../../../src/parts/condition.js';

const rules = GAME_CONFIG_DEFAULTS;

describe('condition', () => {
  describe('performance', () => {
    it('follows wear.performance_slope when it is tuned', () => {
      const tuned = { ...rules, wear: { ...rules.wear, performance_slope: 0.25 } };
      expect(performance(100, tuned)).toBe(rules.wear.performance_floor + 0.25);
    });


    it('returns 1.0 at condition 100', () => {
      expect(performance(100, rules)).toBe(1);
    });

    it('returns 0.75 at condition 50', () => {
      expect(performance(50, rules)).toBe(0.75);
    });

    it('returns the configured floor at condition 0', () => {
      expect(performance(0, rules)).toBe(rules.wear.performance_floor);
    });

    it('scales linearly between floor and 1.0', () => {
      expect(performance(25, rules)).toBe(0.625);
      expect(performance(75, rules)).toBe(0.875);
    });
  });

  describe('chokeChance', () => {
    it('returns 0 at or above the choke threshold', () => {
      expect(chokeChance(30, rules)).toBe(0);
      expect(chokeChance(100, rules)).toBe(0);
    });

    it('returns ~0.111 at condition 20', () => {
      expect(chokeChance(20, rules)).toBeCloseTo(0.111, 3);
    });

    it('returns ~0.444 at condition 10', () => {
      expect(chokeChance(10, rules)).toBeCloseTo(0.444, 3);
    });

    it('is near-dead at condition 1', () => {
      expect(chokeChance(1, rules)).toBeGreaterThan(0.9);
    });
  });

  describe('isDead', () => {
    it('returns false above the dead threshold', () => {
      expect(isDead(2, rules)).toBe(false);
    });

    it('returns true at or below the dead threshold', () => {
      expect(isDead(1, rules)).toBe(true);
      expect(isDead(0, rules)).toBe(true);
    });
  });
});
