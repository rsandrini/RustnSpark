import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { contractOdds, digExtra } from '../../../src/missions/mining-odds.js';

const rules = GAME_CONFIG_DEFAULTS;
const ORES = [
  { id: 'common_ore', rarity: 'common', price: 200 },
  { id: 'uncommon_minerals', rarity: 'uncommon', price: 600 },
  { id: 'rare_crystals', rarity: 'rare', price: 2000 },
];

describe('mining offer odds and the dig on top of a trip', () => {
  it('a stronger drill needs less time and has better odds for the same contract', () => {
    const args = {
      materialId: 'uncommon_minerals',
      required: 10,
      ores: ORES,
      richness: 0.6,
      drillRarity: 'COMMON',
    };
    const small = contractOdds({ ...args, drill: { min: 1, condition: 100, crg: 16 } }, rules);
    const heavy = contractOdds({ ...args, drill: { min: 4.6, condition: 100, crg: 16 } }, rules);
    expect(heavy.expectedSeconds).toBeLessThan(small.expectedSeconds);
    expect(heavy.successChance).toBeGreaterThan(small.successChance);
    expect(small.spaceUnits).toBe(32);
  });

  it('a chemical ship pays fuel for every dig tick (rounded up), an ion-only ship digs for free', () => {
    const tick = rules.mining.job_duration_seconds;
    const perTick = rules.mining.job_fuel_per_tick;
    expect(digExtra(2 * tick, 1, rules)).toEqual({ seconds: 2 * tick, fuel: 2 * perTick });
    expect(digExtra(tick + 1, 1, rules).fuel).toBe(2 * perTick);
    expect(digExtra(2 * tick, 0, rules).fuel).toBe(0);
    expect(digExtra(0, 1, rules).fuel).toBe(0);
  });
});
