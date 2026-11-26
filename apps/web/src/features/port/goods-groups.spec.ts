import { describe, expect, it } from 'vitest';
import { goodsGroupOf, groupGoods } from './goods-groups';

describe('goodsGroupOf', () => {
  it('puts scrap in its own group', () => {
    expect(goodsGroupOf('scrap')).toBe('scrap');
  });

  it('puts the core fragment and the cores together', () => {
    expect(goodsGroupOf('core_fragment')).toBe('cores');
    expect(goodsGroupOf('prototype_core')).toBe('cores');
    expect(goodsGroupOf('ancient_core')).toBe('cores');
  });

  it('treats everything else as ore and minerals', () => {
    expect(goodsGroupOf('common_ore')).toBe('ore');
    expect(goodsGroupOf('rare_crystals')).toBe('ore');
    expect(goodsGroupOf('uncommon_minerals')).toBe('ore');
  });
});

describe('groupGoods', () => {
  it('orders ore, scrap, cores and leaves the empty groups out', () => {
    const grouped = groupGoods([
      { materialId: 'prototype_core' },
      { materialId: 'scrap' },
      { materialId: 'iron' },
      { materialId: 'rare_crystals' },
    ]);
    expect(grouped.map((entry) => entry.group)).toEqual(['ore', 'scrap', 'cores']);
    expect(grouped[0]?.items.map((item) => item.materialId)).toEqual(['iron', 'rare_crystals']);
    expect(groupGoods([{ materialId: 'scrap' }]).map((entry) => entry.group)).toEqual(['scrap']);
    expect(groupGoods([])).toEqual([]);
  });
});
