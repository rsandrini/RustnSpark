import { describe, expect, it } from '@jest/globals';
import { formatsForBridge } from '../../../src/ships/bridge-format.js';

const format = (id: string, minRarity: string, minBridgeSize = 1) => ({
  id,
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

const ids = (list: Array<{ id: string }>) => list.map((entry) => entry.id).sort();

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

  it('a big bridge of a high rarity sees its rarity shapes next to the big format', () => {
    // a 2x2 bridge of UNCOMMON rarity: no UNCOMMON format needs a 2x2 bridge, so both the
    // uncommon shapes and the biggest format are offered (not just the common big one)
    expect(
      ids(
        formatsForBridge(
          ALL.filter((entry) => entry.id !== 'huge'),
          { rarity: 'UNCOMMON', w: 2, h: 2 },
        ),
      ),
    ).toEqual(['big', 'tall', 'wide']);
    // a RARE 2x2 bridge unlocks the rare big format as well: that one is the exact level
    expect(ids(formatsForBridge(ALL, { rarity: 'RARE', w: 2, h: 2 }))).toEqual(['huge']);
  });

  it('is empty when nothing is unlocked', () => {
    expect(formatsForBridge([], { rarity: 'COMMON', w: 1, h: 1 })).toEqual([]);
  });
});
