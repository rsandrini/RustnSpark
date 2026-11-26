import { describe, expect, it } from '@jest/globals';
import { createRng } from '../../../src/common/rng/rng.js';
import { conditionMultiplier } from '../../../src/economy/price.calculator.js';
import {
  rollScrapYield,
  scrapYieldRange,
  type ScrapYieldInput,
  type ScrapYieldRules,
} from '../../../src/economy/scrap-yield.js';

const R: ScrapYieldRules = {
  base: { COMMON: 1, UNCOMMON: 2, RARE: 3, EPIC: 5, LEGENDARY: 8 },
  perExtraCell: 0.5,
  bonusRolls: 3,
  bonusChance: { COMMON: 0.15, UNCOMMON: 0.25, RARE: 0.35, EPIC: 0.45, LEGENDARY: 0.55 },
  sellRatio: 0.6,
  sellMinCondition: 15,
  scrapUnitPrice: 40,
};

describe('scrap yield', () => {
  it('reports the range and the bonus chance', () => {
    const common: ScrapYieldInput = {
      rarity: 'COMMON',
      cells: 1,
      condition: 100,
      basePrice: 10000,
    };
    expect(scrapYieldRange(common, R)).toEqual({ min: 1, max: 4, chance: 0.15 });
    const rare = scrapYieldRange({ rarity: 'RARE', cells: 4, condition: 50, basePrice: 10000 }, R);
    expect(rare.min).toBe(4);
    expect(rare.chance).toBeCloseTo(0.175, 10);
  });

  it('gives no bonus at 0% condition, for any seed', () => {
    const input: ScrapYieldInput = { rarity: 'EPIC', cells: 1, condition: 0, basePrice: 10000 };
    expect(scrapYieldRange(input, R).chance).toBe(0);
    for (let i = 0; i < 100; i += 1) {
      expect(rollScrapYield(input, R, createRng(`scrap:${i}`)).bonus).toBe(0);
    }
  });

  it('is fixed for a seed', () => {
    const input: ScrapYieldInput = { rarity: 'RARE', cells: 2, condition: 70, basePrice: 10000 };
    expect(rollScrapYield(input, R, createRng('scrap:p1'))).toEqual(
      rollScrapYield(input, R, createRng('scrap:p1')),
    );
  });

  it('never beats selling for a sellable part, and does not cap a damaged one', () => {
    const basePrice = 120;
    for (let seed = 0; seed < 200; seed += 1) {
      for (const condition of [15, 50, 100]) {
        const input: ScrapYieldInput = { rarity: 'LEGENDARY', cells: 4, condition, basePrice };
        const { pieces } = rollScrapYield(input, R, createRng(`scrap:${seed}`));
        const bestSell = Math.floor(basePrice * conditionMultiplier(condition) * R.sellRatio);
        expect(pieces * R.scrapUnitPrice).toBeLessThanOrEqual(Math.max(R.scrapUnitPrice, bestSell));
      }
    }
    const damaged: ScrapYieldInput = { rarity: 'LEGENDARY', cells: 4, condition: 10, basePrice };
    const { base, pieces } = rollScrapYield(damaged, R, createRng('scrap:x'));
    expect(pieces).toBeGreaterThanOrEqual(base);
    expect(base).toBe(9);
  });

  it('pays a healthy rare more than a worn common, on average', () => {
    const mean = (input: ScrapYieldInput): number => {
      let sum = 0;
      for (let i = 0; i < 500; i += 1) sum += rollScrapYield(input, R, createRng(`s:${i}`)).pieces;
      return sum / 500;
    };
    const rare = mean({ rarity: 'RARE', cells: 1, condition: 100, basePrice: 100000 });
    const common = mean({ rarity: 'COMMON', cells: 1, condition: 20, basePrice: 100000 });
    expect(rare).toBeGreaterThan(common);
  });

  it('caps between base and base + bonus when the sale would pay less', () => {
    // bestSell = floor(500 * 1 * 0.6) = 300 -> 7 pieces at 40 each, against a legendary max of 8 + 3 + 1.
    const input: ScrapYieldInput = {
      rarity: 'LEGENDARY',
      cells: 4,
      condition: 100,
      basePrice: 500,
    };
    const range = scrapYieldRange(input, R);
    expect(range.min).toBe(7);
    expect(range.max).toBe(7);
    expect(rollScrapYield(input, R, createRng('scrap:cap')).pieces).toBe(7);
    // The cap bites between base and base + bonus: EPIC 1 cell is 5..8, capped at 7.
    const epic: ScrapYieldInput = { rarity: 'EPIC', cells: 1, condition: 100, basePrice: 500 };
    expect(scrapYieldRange(epic, R)).toEqual({ min: 5, max: 7, chance: 0.45 });
    for (let i = 0; i < 200; i += 1) {
      expect(rollScrapYield(epic, R, createRng(`scrap:${i}`)).pieces).toBeLessThanOrEqual(7);
    }
  });
});
