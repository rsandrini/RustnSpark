import { describe, expect, it } from '@jest/globals';
import { createRng } from '../../../src/common/rng/rng.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import {
  chanceToReach,
  findsPerTick,
  keepBest,
  oreMix,
  oreSpace,
  rollFinds,
  rollOre,
  ticksFor,
} from '../../../src/resolution/mining/mining-yield.js';

const rules = GAME_CONFIG_DEFAULTS;
const value = (id: string) =>
  ({
    common_ore: { rarityRank: 0, price: 200 },
    cheap_common: { rarityRank: 0, price: 100 },
    uncommon_minerals: { rarityRank: 1, price: 600 },
    rare_crystals: { rarityRank: 2, price: 2000 },
  })[id] ?? { rarityRank: 0, price: 0 };

describe('mining yield rules (v0.1.3)', () => {
  describe('keepBest: the cheapest ore is dropped over the space', () => {
    it('owner example: 20 common + 5 uncommon + 1 rare over a limit of 20 keeps 14 common and drops 6 common', () => {
      const { kept, dropped } = keepBest(
        new Map([
          ['common_ore', 20],
          ['uncommon_minerals', 5],
          ['rare_crystals', 1],
        ]),
        20,
        value,
      );
      expect(Object.fromEntries(kept)).toEqual({
        rare_crystals: 1,
        uncommon_minerals: 5,
        common_ore: 14,
      });
      expect(Object.fromEntries(dropped)).toEqual({ common_ore: 6 });
    });

    it('keeps everything when it fits, and drops nothing', () => {
      const { kept, dropped } = keepBest(new Map([['common_ore', 3]]), 10, value);
      expect(kept.get('common_ore')).toBe(3);
      expect(dropped.size).toBe(0);
    });

    it('a limit of zero keeps nothing', () => {
      const { kept, dropped } = keepBest(new Map([['rare_crystals', 2]]), 0, value);
      expect(kept.size).toBe(0);
      expect(dropped.get('rare_crystals')).toBe(2);
    });

    it('the reserved contract ore is kept before anything else, even when it is the cheapest', () => {
      const { kept, dropped } = keepBest(
        new Map([
          ['common_ore', 12],
          ['rare_crystals', 10],
        ]),
        15,
        value,
        { id: 'common_ore', units: 10 },
      );
      expect(kept.get('common_ore')).toBe(10);
      expect(kept.get('rare_crystals')).toBe(5);
      expect(dropped.get('common_ore')).toBe(2);
      expect(dropped.get('rare_crystals')).toBe(5);
    });

    it('ties in rarity drop the lower price first, then the id order', () => {
      const { dropped } = keepBest(
        new Map([
          ['common_ore', 5],
          ['cheap_common', 5],
        ]),
        5,
        value,
      );
      expect(dropped.get('cheap_common')).toBe(5);
      expect(dropped.has('common_ore')).toBe(false);
    });
  });

  describe('oreMix', () => {
    const ores = [
      { id: 'common_ore', rarity: 'common' },
      { id: 'uncommon_minerals', rarity: 'uncommon' },
      { id: 'rare_crystals', rarity: 'rare' },
    ];

    it('follows the weights 60/30/10 for a common drill and the shares add up to 1', () => {
      const mix = oreMix(ores, 'COMMON', rules);
      expect(mix.get('common_ore')).toBeCloseTo(0.6, 5);
      expect(mix.get('uncommon_minerals')).toBeCloseTo(0.3, 5);
      expect(mix.get('rare_crystals')).toBeCloseTo(0.1, 5);
    });

    it('a better drill moves the mix towards the rare ores', () => {
      const common = oreMix(ores, 'COMMON', rules);
      const rare = oreMix(ores, 'RARE', rules);
      const legendary = oreMix(ores, 'LEGENDARY', rules);
      expect(rare.get('rare_crystals')!).toBeGreaterThan(common.get('rare_crystals')!);
      expect(legendary.get('rare_crystals')!).toBeGreaterThan(rare.get('rare_crystals')!);
      expect([...legendary.values()].reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 9);
    });

    it('a place with one ore is that ore at 100%', () => {
      const mix = oreMix([{ id: 'rare_crystals', rarity: 'rare' }], 'COMMON', rules);
      expect(mix.get('rare_crystals')).toBe(1);
    });

    it('weights that add up to nothing fall back to an even split', () => {
      const flat = { ...rules, mining: { ...rules.mining, mix_weights: {} } };
      const mix = oreMix(ores, 'COMMON', flat);
      expect(mix.get('common_ore')).toBeCloseTo(1 / 3, 9);
    });
  });

  describe('rollOre', () => {
    it('picks every ore about as often as its share, deterministically', () => {
      const mix = new Map([
        ['common_ore', 0.6],
        ['uncommon_minerals', 0.3],
        ['rare_crystals', 0.1],
      ]);
      const rng = createRng('mix');
      const counts: Record<string, number> = {};
      const draws = 4000;
      for (let i = 0; i < draws; i += 1) {
        const id = rollOre(mix, rng);
        counts[id] = (counts[id] ?? 0) + 1;
      }
      expect(counts['common_ore']! / draws).toBeGreaterThan(0.56);
      expect(counts['common_ore']! / draws).toBeLessThan(0.64);
      expect(counts['rare_crystals']! / draws).toBeGreaterThan(0.08);
      expect(counts['rare_crystals']! / draws).toBeLessThan(0.12);
      expect(rollOre(mix, createRng('again'))).toBe(rollOre(mix, createRng('again')));
    });
  });

  describe('findsPerTick and rollFinds', () => {
    it('is mining x performance x richness x yield_k (a drill of 2 in debris at full condition)', () => {
      const expected = findsPerTick({ min: 2, condition: 100 }, 0.6, rules);
      expect(expected).toBeCloseTo(2 * 0.6 * rules.mining.yield_k, 6);
    });

    it('a worn drill and a starved rig find less', () => {
      const full = findsPerTick({ min: 2, condition: 100 }, 0.6, rules);
      expect(findsPerTick({ min: 2, condition: 40 }, 0.6, rules)).toBeLessThan(full);
      expect(findsPerTick({ min: 2, condition: 100, rigPower: 0.5 }, 0.6, rules)).toBeCloseTo(
        full / 2,
        6,
      );
    });

    it('luck: the mean of many rolls sits within 3% of the expectation (small and large)', () => {
      for (const expected of [6, 40]) {
        const rng = createRng(`finds-${expected}`);
        const runs = 4000;
        let total = 0;
        for (let i = 0; i < runs; i += 1) total += rollFinds(expected, rng);
        expect(Math.abs(total / runs - expected) / expected).toBeLessThan(0.03);
      }
    });

    it('never goes below zero and a zero expectation rolls zero', () => {
      const rng = createRng('zero');
      expect(rollFinds(0, rng)).toBe(0);
      for (let i = 0; i < 200; i += 1) expect(rollFinds(0.4, rng)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('oreSpace', () => {
    it('is the cargo times the factor, for the whole job: cargo 16 -> 32', () => {
      expect(oreSpace(16, rules)).toBe(32);
      expect(oreSpace(0, rules)).toBe(0);
      expect(oreSpace(-3, rules)).toBe(0);
    });
  });

  describe('contract odds', () => {
    it('chanceToReach rises with ticks and with the ore share', () => {
      const few = chanceToReach(10, 5, 1, 0.3);
      const more = chanceToReach(10, 5, 4, 0.3);
      expect(more).toBeGreaterThan(few);
      expect(chanceToReach(10, 5, 4, 0.6)).toBeGreaterThan(more);
      expect(chanceToReach(0, 5, 1, 0.3)).toBe(1);
    });

    it('ticksFor gives the fewest ticks that reach the confidence, or null past the cap', () => {
      const ticks = ticksFor(10, 10, 0.3, 0.9, 12);
      expect(ticks).not.toBeNull();
      expect(chanceToReach(10, 10, ticks!, 0.3)).toBeGreaterThanOrEqual(0.9);
      expect(chanceToReach(10, 10, ticks! - 1, 0.3)).toBeLessThan(0.9);
      expect(ticksFor(10, 1, 0.1, 0.9, 12)).toBeNull();
    });

    it('a stronger drill needs no more ticks than a weaker one for the same contract', () => {
      const weak = ticksFor(10, 5, 0.3, 0.9, 12);
      const strong = ticksFor(10, 23, 0.3, 0.9, 12);
      expect(strong!).toBeLessThanOrEqual(weak!);
    });
  });
});
