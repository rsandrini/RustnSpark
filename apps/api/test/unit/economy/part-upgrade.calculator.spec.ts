import { describe, expect, it } from '@jest/globals';
import {
  basePartTypeOf,
  nextTierPartTypeOf,
  partUpgradeCost,
} from '../../../src/economy/part-upgrade.calculator.js';

describe('basePartTypeOf', () => {
  it('strips a known rarity suffix', () => {
    expect(basePartTypeOf('hull_rare', 'RARE')).toBe('hull');
    expect(basePartTypeOf('hull_legendary', 'LEGENDARY')).toBe('hull');
  });

  it('leaves a COMMON part type untouched (no suffix)', () => {
    expect(basePartTypeOf('hull', 'COMMON')).toBe('hull');
  });

  it('leaves a type unchanged if it does not actually end in the rarity suffix', () => {
    expect(basePartTypeOf('hull', 'RARE')).toBe('hull');
  });
});

describe('nextTierPartTypeOf', () => {
  it('walks the tier chain up one step at a time', () => {
    expect(nextTierPartTypeOf('hull', 'COMMON')).toBe('hull_uncommon');
    expect(nextTierPartTypeOf('hull_uncommon', 'UNCOMMON')).toBe('hull_rare');
    expect(nextTierPartTypeOf('hull_rare', 'RARE')).toBe('hull_epic');
    expect(nextTierPartTypeOf('hull_epic', 'EPIC')).toBe('hull_legendary');
  });

  it('returns null past the top tier', () => {
    expect(nextTierPartTypeOf('hull_legendary', 'LEGENDARY')).toBeNull();
  });

  it('returns null for an unrecognized rarity string', () => {
    expect(nextTierPartTypeOf('hull', 'MYTHIC')).toBeNull();
  });
});

describe('partUpgradeCost', () => {
  it('marks up the price gap to the next tier', () => {
    expect(partUpgradeCost(100, 200, 1.15)).toBe(115);
  });

  it('is never free even if the next tier is not pricier', () => {
    expect(partUpgradeCost(200, 200, 1.15)).toBe(1);
    expect(partUpgradeCost(300, 200, 1.15)).toBe(1);
  });
});
