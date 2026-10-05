import { describe, expect, it } from '@jest/globals';
import { createRng } from '../../../src/common/rng/rng.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import {
  rollScavengeFinds,
  type ScavengeContext,
} from '../../../src/resolution/scavenge/scavenge.resolver.js';

const rules = GAME_CONFIG_DEFAULTS;
const CATALOG = [
  { partType: 'cargo', rarity: 'COMMON' },
  { partType: 'hull', rarity: 'COMMON' },
  { partType: 'radar', rarity: 'UNCOMMON' },
  { partType: 'laser', rarity: 'UNCOMMON' },
  { partType: 'missile', rarity: 'RARE' },
];
const TIERS = [
  { tier: 'COMMON', chance: 0.6 },
  { tier: 'UNCOMMON', chance: 0.3 },
  { tier: 'RARE', chance: 0.1 },
];
const place = (over: Partial<ScavengeContext> = {}): ScavengeContext => ({
  zone: 0,
  fieldType: 'common',
  scrapPlace: false,
  tiers: TIERS,
  catalog: CATALOG,
  ...over,
});
const many = (context: ScavengeContext, runs = 600) =>
  Array.from({ length: runs }, (_, seed) =>
    rollScavengeFinds(context, rules, createRng(`s-${seed}`)),
  );

describe('scavenging finds (W8)', () => {
  it('always finds something, and only USED parts (a condition roll, never new)', () => {
    for (const finds of many(place())) {
      expect(finds.length).toBeGreaterThan(0);
      for (const find of finds) {
        expect(find.kind).toBe('part');
        expect(find.condition).toBeGreaterThanOrEqual(rules.scavenging.quality_min);
        expect(find.condition).toBeLessThan(100);
      }
    }
  });

  it('risk pays: a dangerous zone finds rarer, better parts than a safe one', () => {
    const avg = (context: ScavengeContext) => {
      const finds = many(context).flat();
      return {
        condition: finds.reduce((sum, find) => sum + find.condition, 0) / finds.length,
        rare:
          finds.filter(
            (find) => CATALOG.find((c) => c.partType === find.partType)?.rarity !== 'COMMON',
          ).length / finds.length,
      };
    };
    const safe = avg(place({ zone: 0 }));
    const risky = avg(place({ zone: 3 }));
    expect(risky.condition).toBeGreaterThan(safe.condition + 8);
    expect(risky.rare).toBeGreaterThan(safe.rare);
  });

  it('a pirate-held field is generous: more finds than an ordinary port', () => {
    const count = (context: ScavengeContext) =>
      many(context).reduce((sum, finds) => sum + finds.length, 0) / 600;
    expect(count(place({ fieldType: 'pirate' }))).toBeGreaterThan(
      count(place({ fieldType: 'common' })),
    );
  });

  it('scrap only turns up in scrap places, at the configured share', () => {
    const plain = many(place({ scrapPlace: false })).flat();
    expect(plain.every((find) => find.kind === 'part')).toBe(true);
    const scrap = many(place({ scrapPlace: true })).flat();
    const share = scrap.filter((find) => find.kind === 'scrap').length / scrap.length;
    expect(share).toBeGreaterThan(rules.scavenging.scrap_share - 0.08);
    expect(share).toBeLessThan(rules.scavenging.scrap_share + 0.08);
  });

  it('is deterministic for a seed', () => {
    const context = place({ zone: 2, scrapPlace: true, fieldType: 'pirate' });
    expect(rollScavengeFinds(context, rules, createRng('same'))).toEqual(
      rollScavengeFinds(context, rules, createRng('same')),
    );
  });

  it('finds nothing only when the catalog is empty', () => {
    expect(rollScavengeFinds(place({ catalog: [] }), rules, createRng('x'))).toEqual([]);
  });
});
