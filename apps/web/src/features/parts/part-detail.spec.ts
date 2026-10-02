import { describe, expect, it } from 'vitest';
import { lowestRarity } from './part-detail';

// Round-10 owner request: "the rarity of the ship will be the lowest rarity part that is
// installed" — a ship's own rarity badge is just this function's result over its installed
// parts' rarities.
describe('lowestRarity', () => {
  it('picks the lowest tier among a mixed set, regardless of order', () => {
    expect(lowestRarity(['RARE', 'COMMON', 'EPIC'])).toBe('COMMON');
    expect(lowestRarity(['LEGENDARY', 'RARE'])).toBe('RARE');
  });

  it('returns that rarity when every part shares it', () => {
    expect(lowestRarity(['UNCOMMON', 'UNCOMMON'])).toBe('UNCOMMON');
  });

  it('is undefined for an empty set (no parts installed)', () => {
    expect(lowestRarity([])).toBeUndefined();
  });

  it('never lets an unrecognized rarity string win as "lowest"', () => {
    expect(lowestRarity(['typo-rarity', 'RARE'])).toBe('RARE');
  });
});
