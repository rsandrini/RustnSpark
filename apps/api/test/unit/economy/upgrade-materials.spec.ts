import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { sizeFactor, upgradeNeeds } from '../../../src/economy/upgrade-materials.js';

const rules = GAME_CONFIG_DEFAULTS;

describe('upgrade materials', () => {
  it('sizes the part in four steps', () => {
    expect([1, 2, 3, 4, 6, 9, 16].map(sizeFactor)).toEqual([1, 1, 2, 2, 3, 3, 4]);
  });

  it('common → uncommon asks for scrap that grows slowly with the price gap', () => {
    expect(upgradeNeeds('COMMON', 100, 1, rules)).toEqual([{ material: 'scrap', quantity: 2 }]);
    expect(upgradeNeeds('COMMON', 400, 4, rules)).toEqual([{ material: 'scrap', quantity: 4 }]);
    expect(upgradeNeeds('COMMON', 3500, 16, rules)).toEqual([{ material: 'scrap', quantity: 12 }]);
  });

  it('the rarer the step, the more it asks for: crystals, then a core, then two kinds of core', () => {
    const rare = upgradeNeeds('RARE', 600, 1, rules).map((need) => need.material);
    expect(rare).toEqual(['prototype_core', 'rare_crystals']);
    const epic = upgradeNeeds('EPIC', 1200, 4, rules);
    expect(epic).toEqual([
      { material: 'ancient_core', quantity: 2 },
      { material: 'prototype_core', quantity: 4 },
      { material: 'rare_crystals', quantity: 6 },
    ]);
  });

  it('a rarity with no rule asks for nothing', () => {
    expect(upgradeNeeds('LEGENDARY', 1000, 4, rules)).toEqual([]);
  });
});
