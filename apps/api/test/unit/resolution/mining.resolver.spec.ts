import { describe, expect, it } from '@jest/globals';
import { ScriptedRng } from '../../../src/common/rng/scripted.rng.js';
import { createRng } from '../../../src/common/rng/rng.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import {
  miningChance,
  resolveMining,
  settleContractedMining,
  toMiningLootEvents,
  type MinerRig,
  type MiningStop,
} from '../../../src/resolution/mining/mining.resolver.js';
import { MINING_CASES } from '../../fixtures/appendix-e.js';

const rules: GameRules = GAME_CONFIG_DEFAULTS;

function stop(overrides: Partial<MiningStop> = {}): MiningStop {
  return {
    env: 'debris',
    materialId: 'common_ore',
    materialRarity: 'common',
    ...overrides,
  };
}

function miner(overrides: Partial<MinerRig> = {}): MinerRig {
  return { min: 1, condition: 100, ...overrides };
}

function allMissTape(count: number): { fn: 'random'; args: []; value: number }[] {
  return Array.from({ length: count }, () => ({ fn: 'random' as const, args: [] as [], value: 1 }));
}

describe('S5.6 — mining chance (Appendix E MINING_CASES)', () => {
  it('every case matches richness × (1 − rarity) × MIN × performance', () => {
    for (const c of MINING_CASES) {
      const chance = miningChance(
        stop({ env: c.env, materialRarity: c.material }),
        miner({ min: c.minerMin, condition: c.minerCondition }),
        rules,
      );
      expect({ name: c.name, chance }).toEqual({
        name: c.name,
        chance: expect.closeTo(c.chance, 12),
      });
    }
  });

  it('clamps chance into [0, 1]', () => {
    const high = miningChance(
      stop({ env: 'debris', materialRarity: 'common' }),
      miner({ min: 10, condition: 100 }),
      rules,
    );
    expect(high).toBe(1);
    const unknown = miningChance(stop({ env: 'void', materialRarity: 'common' }), miner(), rules);
    expect(unknown).toBe(0);
  });

  it('pins attempts per stop', () => {
    expect(rules.mining.attempts_per_stop).toBe(10);
  });
});

describe('S5.6 — resolveMining', () => {
  it('returns empty yield when every attempt misses', () => {
    const rng = new ScriptedRng(allMissTape(rules.mining.attempts_per_stop), [], 'all-miss');
    expect(resolveMining(stop(), miner(), rules, rng)).toEqual([]);
    rng.assertDrained();
  });

  it('returns the material id and success count when attempts hit', () => {
    // chance = 0.42 on pristine debris/common; float 0.1 hits, 0.9 misses.
    const tape = [
      { fn: 'random' as const, args: [] as [], value: 0.1 },
      ...allMissTape(rules.mining.attempts_per_stop - 1),
    ];
    const rng = new ScriptedRng(tape, [], 'one-hit');
    const yieldEntries = resolveMining(stop(), miner(), rules, rng);
    expect(yieldEntries).toEqual([{ materialId: 'common_ore', quantity: 1 }]);
    rng.assertDrained();
  });

  it('draws exactly attempts_per_stop times even when chance is 0', () => {
    const rng = new ScriptedRng(allMissTape(rules.mining.attempts_per_stop), [], 'zero-chance');
    expect(resolveMining(stop({ env: 'void' }), miner(), rules, rng)).toEqual([]);
    rng.assertDrained();
  });

  it('emits loot events carrying the material id', () => {
    const rng = new ScriptedRng(
      [
        { fn: 'random' as const, args: [] as [], value: 0 },
        ...allMissTape(rules.mining.attempts_per_stop - 1),
      ],
      [],
      'loot',
    );
    const yieldEntries = resolveMining(stop(), miner(), rules, rng);
    expect(toMiningLootEvents(yieldEntries)).toEqual([
      { category: 'loot', type: 'mining', materialId: 'common_ore', quantity: 1 },
    ]);
    rng.assertDrained();
  });

  it('is deterministic for the same seed', () => {
    const a = resolveMining(stop(), miner(), rules, createRng(42));
    const b = resolveMining(stop(), miner(), rules, createRng(42));
    expect(a).toEqual(b);
  });
});

describe('S5.6 — contracted mining settlement (GDD §12)', () => {
  it('pays only when the required quantity is met', () => {
    expect(settleContractedMining(5, 5)).toEqual({ status: 'paid', settled: true });
    expect(settleContractedMining(6, 5)).toEqual({ status: 'paid', settled: true });
    expect(settleContractedMining(4, 5)).toEqual({
      status: 'partial_failure',
      settled: false,
    });
    expect(settleContractedMining(0, 1)).toEqual({
      status: 'partial_failure',
      settled: false,
    });
    expect(settleContractedMining(0, 0)).toEqual({
      status: 'partial_failure',
      settled: false,
    });
  });
});
