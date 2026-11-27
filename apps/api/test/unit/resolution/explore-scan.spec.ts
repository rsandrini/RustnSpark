import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import {
  areaOf,
  planScan,
  scanCovered,
  scanFuel,
  scanPerTick,
  scanStrength,
} from '../../../src/resolution/explore/explore-scan.js';

const rules = GAME_CONFIG_DEFAULTS;

describe('planScan', () => {
  it('exact fit: strength 4 scans 60 in 10 ticks', () => {
    expect(planScan(60, 4, rules)).toEqual({
      ticks: 10,
      perTick: 6,
      covered: 60,
      share: 1,
      seconds: 3000,
    });
  });

  it('capped plan: 80 needs 13.3 ticks, the cap is 12', () => {
    expect(planScan(80, 4, rules)).toMatchObject({
      ticks: 12,
      covered: 72,
      share: 0.9,
      seconds: 3600,
    });
  });

  it('the pure function does not gate: 120 is planned at 0.6', () => {
    expect(planScan(120, 4, rules)).toMatchObject({ ticks: 12, covered: 72, share: 0.6 });
  });

  it('a dead radar scans nothing and every number stays finite', () => {
    const plan = planScan(80, 0, rules);
    expect(plan).toMatchObject({ ticks: 12, covered: 0, share: 0 });
    expect(Object.values(plan).every(Number.isFinite)).toBe(true);
  });

  it('float error never adds a tick (0.1-type ratios)', () => {
    const odd = { ...rules, explore: { ...rules.explore, scan_k: 0.1 } };
    // perTick = 3 x 0.1 = 0.30000000000000004; area 0.3 x 10 = 3 must take 10 ticks, not 11
    expect(planScan(3, 3, odd).ticks).toBe(10);
  });

  it('NaN or infinite inputs give a finite plan', () => {
    for (const bad of [Number.NaN, Infinity]) {
      const plan = planScan(bad, bad, rules);
      expect(Object.values(plan).every(Number.isFinite)).toBe(true);
    }
  });

  it('an empty area has share 0', () => {
    expect(planScan(0, 4, rules).share).toBe(0);
  });
});

describe('scanStrength', () => {
  const radar = { partClass: 'SENSOR', sen: 8, condition: 50 };

  it('is sen x performance(condition): 8 x 0.75 = 6', () => {
    expect(scanStrength([radar], rules)).toBeCloseTo(6, 9);
  });

  it('a dead radar gives 0', () => {
    expect(scanStrength([{ ...radar, condition: 1 }], rules)).toBe(0);
  });

  it('a disconnected radar gives 0', () => {
    expect(scanStrength([{ ...radar, connected: false }], rules)).toBe(0);
  });

  it('only SENSOR parts count', () => {
    expect(scanStrength([{ partClass: 'HULL', sen: 5, condition: 100 }], rules)).toBe(0);
    expect(scanStrength([{ partClass: 'SENSOR', sen: 0, condition: 100 }], rules)).toBe(0);
  });

  it('a NaN sen counts as 0', () => {
    expect(scanStrength([{ ...radar, sen: Number.NaN }, radar], rules)).toBeCloseTo(6, 9);
  });
});

describe('scanPerTick', () => {
  it('follows strength x scan_k x the power share', () => {
    expect(scanPerTick(4, 1, rules)).toBe(6);
    expect(scanPerTick(4, 0.5, rules)).toBe(3);
  });

  it('clamps the share and never goes negative or NaN', () => {
    expect(scanPerTick(4, 2, rules)).toBe(6);
    expect(scanPerTick(4, -1, rules)).toBe(0);
    expect(scanPerTick(-4, 1, rules)).toBe(0);
    expect(scanPerTick(Number.NaN, 1, rules)).toBe(0);
    expect(scanPerTick(4, Number.NaN, rules)).toBe(0);
  });
});

describe('scanCovered', () => {
  it('stops at the tick that reaches the area', () => {
    expect(scanCovered(60, 6, 12)).toEqual({ covered: 60, ticksRun: 10 });
  });

  it('runs every tick when the area is not reached', () => {
    expect(scanCovered(80, 6, 12)).toEqual({ covered: 72, ticksRun: 12 });
  });

  it('covers whole units only', () => {
    expect(scanCovered(100, 2.5, 3).covered).toBe(7);
  });

  it('is safe against float error and zero or NaN input', () => {
    expect(scanCovered(3, 0.30000000000000004, 10)).toEqual({ covered: 3, ticksRun: 10 });
    expect(scanCovered(80, 0, 12)).toEqual({ covered: 0, ticksRun: 12 });
    expect(scanCovered(Number.NaN, 6, 12)).toEqual({ covered: 0, ticksRun: 12 });
  });
});

describe('scanFuel', () => {
  it('a ship that burns no fuel scans for free', () => {
    expect(scanFuel(10, 0, rules)).toBe(0);
  });

  it('burns fuel_per_tick for each tick run', () => {
    expect(scanFuel(10, 3, rules)).toBe(250);
  });
});

describe('areaOf', () => {
  it('reads a positive whole area, else 0', () => {
    expect(areaOf({ area: 80 })).toBe(80);
    expect(areaOf({ area: 2.5 })).toBe(0);
    expect(areaOf({ area: 0 })).toBe(0);
    expect(areaOf({ area: -3 })).toBe(0);
    expect(areaOf({ area: Number.NaN })).toBe(0);
    expect(areaOf(null)).toBe(0);
    expect(areaOf('x')).toBe(0);
  });
});
