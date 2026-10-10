import { describe, expect, it } from '@jest/globals';
import { createRng } from '../../../src/common/rng/rng.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { dropsAtZone, rollCoreDrops } from '../../../src/resolution/loot/core-drops.js';

const rules = GAME_CONFIG_DEFAULTS;

describe('core drops', () => {
  it('the safe zones find nothing; zone 2 and 3 use their own tables', () => {
    expect(dropsAtZone('mission', 0, rules)).toEqual([]);
    expect(dropsAtZone('mission', 1, rules)).toEqual([]);
    expect(dropsAtZone('mission', 2, rules).map((drop) => drop.material)).toEqual([
      'core_fragment',
    ]);
    expect(dropsAtZone('scavenge', 3, rules).map((drop) => drop.material)).toContain(
      'prototype_core',
    );
    // a zone above the highest listed one keeps using the highest
    expect(dropsAtZone('mission', 7, rules)).toEqual(dropsAtZone('mission', 3, rules));
  });

  it('is deterministic for a seed, and finds nothing in a safe zone', () => {
    expect(rollCoreDrops('mission', 3, rules, createRng('s'))).toEqual(
      rollCoreDrops('mission', 3, rules, createRng('s')),
    );
    expect(rollCoreDrops('mission', 1, rules, createRng('s'))).toEqual([]);
  });

  it('over many runs the chances show up, and an ancient core stays rarer than a prototype core', () => {
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 4000; seed += 1) {
      for (const found of rollCoreDrops('mission', 3, rules, createRng(`run-${seed}`))) {
        counts.set(found.materialId, (counts.get(found.materialId) ?? 0) + found.quantity);
      }
    }
    expect(counts.get('core_fragment') ?? 0).toBeGreaterThan(counts.get('prototype_core') ?? 0);
    expect(counts.get('prototype_core') ?? 0).toBeGreaterThan(counts.get('ancient_core') ?? 0);
    expect(counts.get('ancient_core') ?? 0).toBeGreaterThan(0);
  });
});
