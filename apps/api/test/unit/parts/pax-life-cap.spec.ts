import { describe, expect, it } from '@jest/globals';
import type { PartCatalog as PartCatalogRow } from '@prisma/client';
import { PARTS } from '../../../prisma/seed-data/parts.js';
import { pickCatalogStats } from '../../../src/parts/parts.service.js';

function rowWith(specialProp: unknown): PartCatalogRow {
  const seed = PARTS.find((part) => part.partType === 'hull')!;
  return { ...seed, specialProp } as unknown as PartCatalogRow;
}

describe('pax and lifeCap on parts', () => {
  it('reads the seats and the life-support capacity from specialProp', () => {
    const catalog = pickCatalogStats(rowWith({ pax: 4, lifeCap: 6 }));
    expect(catalog.pax).toBe(4);
    expect(catalog.lifeCap).toBe(6);
  });

  it('is 0 when absent', () => {
    expect(pickCatalogStats(rowWith(null)).pax).toBe(0);
    expect(pickCatalogStats(rowWith({})).lifeCap).toBe(0);
  });

  it('seeds the cabin and life-support tiers', () => {
    const value = (type: string, key: string) =>
      (
        PARTS.find((part) => part.partType === type)?.specialProp as
          Record<string, number> | undefined
      )?.[key];
    const suffixes = ['', '_uncommon', '_rare', '_epic', '_legendary'];
    expect(suffixes.map((s) => value(`passenger_cabin${s}`, 'pax'))).toEqual([2, 3, 4, 6, 8]);
    expect(suffixes.map((s) => value(`life_support${s}`, 'lifeCap'))).toEqual([3, 4, 6, 8, 10]);
  });
});
