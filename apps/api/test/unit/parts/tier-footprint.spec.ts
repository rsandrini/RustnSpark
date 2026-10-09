import { describe, expect, it } from '@jest/globals';
import { PARTS } from '../../../prisma/seed-data/parts.js';
import { basePartTypeOf } from '../../../src/economy/part-upgrade.calculator.js';

// An upgrade changes rarity and stats, NEVER the footprint: a part that grew would no longer fit
// where it sits. So every tier of a family must be the same size.
describe('part tiers keep their footprint', () => {
  const families = new Map<string, typeof PARTS>();
  for (const part of PARTS) {
    const base = basePartTypeOf(part.partType, part.rarity);
    families.set(base, [...(families.get(base) ?? []), part]);
  }

  it.each([...families])('%s: every rarity is the same size', (_family, tiers) => {
    const sizes = new Set(tiers.map((part) => `${part.w}x${part.h}`));
    expect([...sizes]).toHaveLength(1);
  });

  it('tanks come in three sizes (1x1, 2x1, 3x1) with five rarities each', () => {
    const size = (family: string) =>
      families.get(family)?.map((part) => `${part.w}x${part.h}`)[0] ?? 'missing';
    expect(size('tank_small')).toBe('1x1');
    expect(size('tank_medium')).toBe('2x1');
    expect(size('tank_large')).toBe('3x1');
    for (const family of ['tank_small', 'tank_medium', 'tank_large']) {
      expect(families.get(family)).toHaveLength(5);
    }
  });
});
