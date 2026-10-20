import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { sizeFactor, upgradeNeeds } from '../../../src/economy/upgrade-materials.js';

const rules = GAME_CONFIG_DEFAULTS;

// (the price gaps are at the current money scale: prices are ten times what they were, and the divisors with them)
describe('upgrade materials', () => {
  it('sizes the part in four steps', () => {
    expect([1, 2, 3, 4, 6, 9, 16].map(sizeFactor)).toEqual([1, 1, 2, 2, 3, 3, 4]);
  });

  it('common → uncommon asks for scrap that grows slowly with the price gap', () => {
    expect(upgradeNeeds('COMMON', 1000, 1, rules)).toEqual([{ material: 'scrap', quantity: 2 }]);
    expect(upgradeNeeds('COMMON', 4000, 4, rules)).toEqual([{ material: 'scrap', quantity: 4 }]);
    expect(upgradeNeeds('COMMON', 35000, 16, rules)).toEqual([{ material: 'scrap', quantity: 12 }]);
  });

  it('the rarer the step, the more it asks for: crystals, then fragments, then many more fragments', () => {
    expect(upgradeNeeds('RARE', 6000, 1, rules)).toEqual([
      { material: 'core_fragment', quantity: 5 },
      { material: 'rare_crystals', quantity: 5 },
    ]);
    // 4 cells is size step 2: 25 x 2 fragments (what an ancient core and two prototype cores were).
    expect(upgradeNeeds('EPIC', 12000, 4, rules)).toEqual([
      { material: 'core_fragment', quantity: 50 },
      { material: 'rare_crystals', quantity: 6 },
    ]);
  });

  it('a rarity with no rule asks for nothing', () => {
    expect(upgradeNeeds('LEGENDARY', 10000, 4, rules)).toEqual([]);
  });
});
