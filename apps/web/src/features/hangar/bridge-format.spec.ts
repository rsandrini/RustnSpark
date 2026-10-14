import { describe, expect, it } from 'vitest';
import type { ShipFormat } from '../../api/generated';
import { formatsForBridge } from './bridge-format';

const format = (id: string, minRarity: string, minBridgeSize = 1): ShipFormat => ({
  id,
  displayName: { en: id, 'pt-BR': id },
  description: { en: '', 'pt-BR': '' },
  cells: [[0, 0]],
  minRarity,
  minBridgeSize,
});

const ALL = [
  format('basic', 'COMMON'),
  format('wide', 'UNCOMMON'),
  format('tall', 'UNCOMMON'),
  format('big', 'COMMON', 2),
  format('huge', 'RARE', 2),
];

const ids = (list: ShipFormat[]) => list.map((entry) => entry.id).sort();

describe('formatsForBridge', () => {
  it('offers only the formats of the bridge own rarity and size', () => {
    expect(ids(formatsForBridge(ALL, { rarity: 'UNCOMMON', w: 1, h: 1 }))).toEqual([
      'tall',
      'wide',
    ]);
    expect(ids(formatsForBridge(ALL, { rarity: 'COMMON', w: 2, h: 2 }))).toEqual(['big']);
  });

  it('falls back to the highest tier unlocked when none sits exactly at the level', () => {
    const unlocked = [format('basic', 'COMMON'), format('wide', 'UNCOMMON')];
    expect(ids(formatsForBridge(unlocked, { rarity: 'RARE', w: 1, h: 1 }))).toEqual(['wide']);
  });

  it('is empty when nothing is unlocked', () => {
    expect(formatsForBridge([], { rarity: 'COMMON', w: 1, h: 1 })).toEqual([]);
  });
});
