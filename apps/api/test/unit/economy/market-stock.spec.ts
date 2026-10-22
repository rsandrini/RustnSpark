import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { inStockToday } from '../../../src/economy/market-stock.js';

describe('inStockToday', () => {
  it('is always in stock at chance 1 (COMMON/UNCOMMON default)', () => {
    expect(inStockToday('ceres', '2026-09-30', 'hull', 'COMMON', { COMMON: 1 })).toBe(true);
  });

  it('is never in stock at chance 0 (LEGENDARY default)', () => {
    expect(
      inStockToday('ceres', '2026-09-30', 'hull_legendary', 'LEGENDARY', { LEGENDARY: 0 }),
    ).toBe(false);
  });

  it('defaults an unlisted rarity to always in stock', () => {
    expect(inStockToday('ceres', '2026-09-30', 'hull', 'COMMON', {})).toBe(true);
  });

  it('is deterministic: the same location/day/part/rarity always rolls the same result', () => {
    const chances = { EPIC: 0.01 };
    const first = inStockToday('ceres', '2026-09-30', 'shield_basic_epic', 'EPIC', chances);
    const second = inStockToday('ceres', '2026-09-30', 'shield_basic_epic', 'EPIC', chances);
    expect(first).toBe(second);
  });

  it('a fractional chance sometimes says yes and sometimes no across many part types', () => {
    const chances = { RARE: 0.5 };
    const results = new Set(
      Array.from({ length: 50 }, (_, index) =>
        inStockToday('ceres', '2026-09-30', `part-${index}`, 'RARE', chances),
      ),
    );
    expect(results.has(true)).toBe(true);
    expect(results.has(false)).toBe(true);
  });

  it('rolls independently per day, not just per part type', () => {
    const chances = { RARE: 0.5 };
    const results = new Set(
      Array.from({ length: 50 }, (_, index) =>
        inStockToday(
          'ceres',
          `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
          'shield_basic_rare',
          'RARE',
          chances,
        ),
      ),
    );
    expect(results.has(true)).toBe(true);
    expect(results.has(false)).toBe(true);
  });
});

// The pilot starts with the money for a basic shield and a small battery, and the market tip
// recommends both: a common part must be on every shelf, every day, whatever the bridge.
describe('common parts are always on the shelf', () => {
  const { economy } = GAME_CONFIG_DEFAULTS;
  const chances = [economy.market_rarity_chance, ...Object.values(economy.market_rarity_by_bridge)];

  it('has a chance of 1 for COMMON in the fallback table and in every bridge row', () => {
    for (const chance of chances) expect(chance['COMMON']).toBe(1);
  });

  it('keeps the common shield and the common battery in stock on any day at any port', () => {
    for (const chance of chances) {
      for (const day of ['2026-10-18', '2027-01-01', '2027-06-30']) {
        for (const partType of ['shield_basic', 'battery_small']) {
          expect(inStockToday('anywhere', day, partType, 'COMMON', chance)).toBe(true);
        }
      }
    }
  });

  it('starts a pilot with a small purse: a first tank and a little over, not a shield and a battery as well', () => {
    // owner playtest 2026-10-22: 7500 at the start was far too much; the first missions pay for the shelf
    const shield = 4000;
    const battery = 1500;
    expect(economy.start_credits).toBeGreaterThanOrEqual(2000);
    expect(economy.start_credits).toBeLessThan(shield + battery);
  });
});
