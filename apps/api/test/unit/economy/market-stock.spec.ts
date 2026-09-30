import { describe, expect, it } from '@jest/globals';
import { inStockToday } from '../../../src/economy/market-stock.js';

describe('inStockToday', () => {
  it('is always in stock at chance 1 (COMMON/UNCOMMON default)', () => {
    expect(inStockToday('ceres', '2026-09-30', 'hull', 'COMMON', { COMMON: 1 })).toBe(true);
  });

  it('is never in stock at chance 0 (LEGENDARY default)', () => {
    expect(inStockToday('ceres', '2026-09-30', 'hull_legendary', 'LEGENDARY', { LEGENDARY: 0 })).toBe(
      false,
    );
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
        inStockToday('ceres', `2026-01-${String((index % 28) + 1).padStart(2, '0')}`, 'shield_basic_rare', 'RARE', chances),
      ),
    );
    expect(results.has(true)).toBe(true);
    expect(results.has(false)).toBe(true);
  });
});
