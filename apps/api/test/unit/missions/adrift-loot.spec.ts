import { describe, expect, it } from '@jest/globals';
import { keepsLootAdrift } from '../../../src/missions/resolve.service.js';

describe('what a ship left adrift keeps', () => {
  it('an independent mining job keeps its ore; a delivery or a contract loses its cargo', () => {
    expect(keepsLootAdrift({ type: 'MINING', reward: 0 })).toBe(true);
    expect(keepsLootAdrift({ type: 'MINING', reward: 900 })).toBe(false);
    expect(keepsLootAdrift({ type: 'DELIVERY', reward: 0 })).toBe(false);
    expect(keepsLootAdrift({ type: 'DELIVERY', reward: 400 })).toBe(false);
  });
});
