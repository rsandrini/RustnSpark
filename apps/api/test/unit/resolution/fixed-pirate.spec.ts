import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import {
  fixedPirateFor,
  pirateTierFor,
} from '../../../src/resolution/encounter/pirate.generator.js';

const rules: GameRules = GAME_CONFIG_DEFAULTS;

describe('fixed pirates by region (v0.1.3)', () => {
  it('the tier follows the zone, and a dangerous route raises it', () => {
    expect(pirateTierFor(rules, 0, 1)).toBe(0);
    expect(pirateTierFor(rules, 1, 2)).toBe(1);
    expect(pirateTierFor(rules, 2, 5)).toBe(2);
    expect(pirateTierFor(rules, 3, 8)).toBe(3);
    // danger 9 raises by 1, danger 10 by 2
    expect(pirateTierFor(rules, 3, 9)).toBe(4);
    expect(pirateTierFor(rules, 3, 10)).toBe(5);
    expect(pirateTierFor(rules, 2, 9)).toBe(3);
  });

  it('never goes past the last tier the config has, and an unknown zone meets the toughest zone tier', () => {
    expect(pirateTierFor(rules, 3, 99)).toBe(5);
    const small: GameRules = {
      ...rules,
      encounter: {
        ...rules.encounter,
        pirate_tiers: Object.fromEntries(
          Object.entries(rules.encounter.pirate_tiers).filter(
            ([key]) => Number(key.split('.')[0]) <= 3,
          ),
        ),
      },
    };
    expect(pirateTierFor(small, 3, 10)).toBe(3);
    expect(pirateTierFor(rules, 9, 1)).toBe(3);
  });

  it('the pirate is the same whatever ship it meets: stats come from the tier, nothing from the player', () => {
    const pirate = fixedPirateFor(rules, 3, 8, true);
    expect(pirate).toMatchObject({ hp: 477, pdf: 7, bli: 0, esc: 22, mob: 6, sen: 3 });
    expect(fixedPirateFor(rules, 3, 8, true)).toEqual(pirate);
  });

  it('against a ship in the layered model its armor is a pool and its shield recovers; the old model gets neither', () => {
    const layered = fixedPirateFor(rules, 3, 8, true);
    expect(layered.armor).toBe(0);
    expect(layered.escMax).toBe(22);
    expect(layered.escRegen).toBe(4);
    // a tier with armor: the pool is armor x the pool factor
    expect(fixedPirateFor(rules, 3, 10, true).armor).toBe(5 * rules.combat.armor_pool_factor);
    const old = fixedPirateFor(rules, 3, 8, false);
    expect(old.armor).toBeUndefined();
  });
});
