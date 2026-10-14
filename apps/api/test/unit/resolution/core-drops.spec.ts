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
    // Only fragments are found: a bigger find is a bigger quantity of them.
    expect(new Set(dropsAtZone('scavenge', 3, rules).map((drop) => drop.material))).toEqual(
      new Set(['core_fragment']),
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

  it('over many runs fragments show up, and the big stacks come rarer than the small ones', () => {
    const bySize = new Map<number, number>();
    for (let seed = 0; seed < 4000; seed += 1) {
      for (const found of rollCoreDrops('mission', 3, rules, createRng(`run-${seed}`))) {
        expect(found.materialId).toBe('core_fragment');
        bySize.set(found.quantity, (bySize.get(found.quantity) ?? 0) + 1);
      }
    }
    expect(bySize.get(2) ?? 0).toBeGreaterThan(bySize.get(5) ?? 0);
    expect(bySize.get(5) ?? 0).toBeGreaterThan(bySize.get(15) ?? 0);
    expect(bySize.get(15) ?? 0).toBeGreaterThan(0);
  });
});
