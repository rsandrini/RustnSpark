import { describe, expect, it } from '@jest/globals';
import { createRng } from '../../../src/common/rng/rng.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import {
  rollScavengeFinds,
  type ScavengeContext,
} from '../../../src/resolution/scavenge/scavenge.resolver.js';

const defaults = GAME_CONFIG_DEFAULTS;
// The part-finding rolls are tested with the guaranteed scrap off (its own tests are at the end).
const rules = { ...defaults, scavenging: { ...defaults.scavenging, scrap_min: 0, scrap_max: 0 } };
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
const nonEmpty = (runs: ReturnType<typeof rollScavengeFinds>[]) =>
  runs.filter((finds) => finds.length > 0);
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
  it('finds only USED parts (a condition roll, never new) when it finds anything', () => {
    for (const finds of nonEmpty(many(place()))) {
      for (const find of finds) {
        expect(find.kind).toBe('part');
        expect(find.condition).toBeGreaterThanOrEqual(rules.scavenging.quality_min);
        expect(find.condition).toBeLessThan(100);
      }
    }
  });

  it('risk pays: a dangerous zone finds rarer, better parts than a safe one', () => {
    const avg = (context: ScavengeContext) => {
      const finds = nonEmpty(many(context)).flat();
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

  describe('the P0 review rules: a run is a bonus, not a salary', () => {
    // A cheap and an expensive part of every rarity: only price tells them apart.
    const PRICED = [
      { partType: 'cheap', rarity: 'COMMON', basePrice: 1000 },
      { partType: 'dear', rarity: 'COMMON', basePrice: 100000 },
      { partType: 'huge', rarity: 'COMMON', basePrice: 800000 },
    ];
    const run = (context: ScavengeContext, runs = 800) => many(context, runs).flat();

    it('never brings more part finds than the cap, whatever the place gives', () => {
      const generous = place({ fieldType: 'pirate', catalog: PRICED });
      for (const finds of many(generous, 400)) {
        expect(finds.filter((find) => find.kind === 'part').length).toBeLessThanOrEqual(
          defaults.scavenging.max_part_finds,
        );
      }
    });

    it('a cheap part comes far more often than an expensive one', () => {
      const finds = run(place({ zone: 3, catalog: PRICED }));
      const count = (type: string) => finds.filter((find) => find.partType === type).length;
      expect(count('cheap')).toBeGreaterThan(count('dear') * 10);
      expect(count('dear')).toBeGreaterThanOrEqual(count('huge'));
    });

    it('below zone 3 nothing above the zone cap turns up, and zone 3 has no cap', () => {
      const cap = defaults.scavenging.find_price_cap['2'] ?? 0;
      expect(cap).toBeGreaterThan(0);
      const early = run(place({ zone: 2, catalog: PRICED }));
      expect(early.length).toBeGreaterThan(0);
      expect(early.every((find) => (find.partType === 'cheap' ? true : false))).toBe(true);
      const deep = run(place({ zone: 3, catalog: PRICED }), 4000);
      expect(deep.some((find) => find.partType === 'dear' || find.partType === 'huge')).toBe(true);
    });

    it('a log stored with the old rules (no price in the catalog, defaults off) rolls as before', () => {
      const legacyRules = {
        ...rules,
        scavenging: {
          ...rules.scavenging,
          max_part_finds: 4,
          price_weight_power: 0,
          find_price_cap: {},
        },
      };
      const context = place({ zone: 2, fieldType: 'pirate' });
      const finds = rollScavengeFinds(context, legacyRules, createRng('legacy-seed'));
      const again = rollScavengeFinds(context, legacyRules, createRng('legacy-seed'));
      expect(finds).toEqual(again);
    });
  });

  it('is deterministic for a seed', () => {
    const context = place({ zone: 2, scrapPlace: true, fieldType: 'pirate' });
    expect(rollScavengeFinds(context, rules, createRng('same'))).toEqual(
      rollScavengeFinds(context, rules, createRng('same')),
    );
  });

  it('finds nothing when the catalog is empty', () => {
    expect(rollScavengeFinds(place({ catalog: [] }), rules, createRng('x'))).toEqual([]);
  });

  it('a run can come back empty: often in a safe zone, rarely in a dangerous one', () => {
    const emptyShare = (context: ScavengeContext) =>
      many(context, 2000).filter((finds) => finds.length === 0).length / 2000;
    const safe = emptyShare(place({ zone: 0 }));
    const risky = emptyShare(place({ zone: 3 }));
    expect(safe).toBeGreaterThan(rules.scavenging.nothing_chance[0]! - 0.05);
    expect(safe).toBeLessThan(rules.scavenging.nothing_chance[0]! + 0.05);
    expect(risky).toBeLessThan(safe - 0.2);
  });

  it('rare drops are for dangerous places: none below their minimum zone', () => {
    const rareFinds = (zone: number) =>
      many(
        place({
          zone,
          tiers: [
            { tier: 'COMMON', chance: 0.5 },
            { tier: 'RARE', chance: 0.5 },
          ],
        }),
        1500,
      )
        .flat()
        .filter((find) => CATALOG.find((c) => c.partType === find.partType)?.rarity === 'RARE')
        .length;
    expect(rareFinds(0)).toBe(0);
    expect(rareFinds(1)).toBe(0);
    expect(rareFinds(2)).toBeGreaterThan(0);
  });

  it('a ship that is not flight-ready (handicapped) finds something far less often', () => {
    const found = (handicapped: boolean) =>
      many(place({ zone: 1, handicapped }), 2000).filter((finds) => finds.length > 0).length / 2000;
    const normal = found(false);
    const hand = found(true);
    expect(hand).toBeLessThan(normal * (rules.scavenging.handicap_factor + 0.1));
    expect(hand).toBeGreaterThan(0);
  });

  it('on foot finds less often (foot share), and the foot share replaces the handicap', () => {
    const found = (extra: Partial<ScavengeContext>) =>
      many(place({ zone: 1, ...extra }), 2000).filter((finds) => finds.length > 0).length / 2000;
    const normal = found({});
    const foot = found({ onFoot: true });
    expect(foot).toBeLessThan(normal * (rules.scavenging.foot_factor + 0.1));
    expect(foot).toBeGreaterThan(0);
    // Same run, handicapped or not: on foot there is no ship to judge.
    expect(found({ onFoot: true, handicapped: true })).toBe(foot);
  });
});

describe('scavenging: the scrap every run brings back', () => {
  const withScrap = (least: number, most: number) => ({
    ...defaults,
    scavenging: { ...defaults.scavenging, scrap_min: least, scrap_max: most },
  });
  const scrapOf = (finds: ReturnType<typeof rollScavengeFinds>) =>
    finds.filter((find) => find.kind === 'scrap');

  it('always brings 1 or 2 scrap by default, even from an empty search and a safe port', () => {
    const runs = Array.from({ length: 400 }, (_, seed) =>
      rollScavengeFinds(place({ zone: 0 }), defaults, createRng(`g-${seed}`)),
    );
    const counts = runs.map((finds) => scrapOf(finds).length);
    expect(Math.min(...counts)).toBe(1);
    expect(Math.max(...counts)).toBe(2);
    // some of those runs found no part at all: the scrap is still there
    expect(runs.some((finds) => finds.every((find) => find.kind === 'scrap'))).toBe(true);
  });

  it('is made of the cheapest tier, and turns off at 0', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      for (const find of scrapOf(rollScavengeFinds(place(), defaults, createRng(`c-${seed}`)))) {
        expect(['cargo', 'hull']).toContain(find.partType);
      }
      expect(scrapOf(rollScavengeFinds(place(), withScrap(0, 0), createRng(`c-${seed}`)))).toEqual(
        [],
      );
    }
  });

  it('does not move the part finds: same seed, same parts as without it', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const without = rollScavengeFinds(place(), withScrap(0, 0), createRng(`p-${seed}`));
      const parts = rollScavengeFinds(place(), defaults, createRng(`p-${seed}`)).filter(
        (find) => find.kind === 'part',
      );
      expect(parts).toEqual(without.filter((find) => find.kind === 'part'));
    }
  });
});
