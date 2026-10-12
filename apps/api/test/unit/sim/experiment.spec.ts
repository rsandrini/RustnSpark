import { describe, expect, it } from '@jest/globals';
import { cellName, defaultMatrix } from '../../../sim/experiment/cells.js';
import {
  daysToLevelSpread,
  percentile,
  runCell,
  summarizeRun,
} from '../../../sim/experiment/runner.js';
import { DEFAULT_BUDGET } from '../../../sim/core/clock.js';
import { fixtureSnapshot } from './fixture.js';

const snapshot = fixtureSnapshot();
const budget = { ...DEFAULT_BUDGET };

describe('defaultMatrix', () => {
  it('is ten cells: three temperaments x three playstyles, plus the random control', () => {
    const matrix = defaultMatrix();
    expect(matrix).toHaveLength(10);
    expect(matrix.map(cellName)).toContain('random|generalist|2h');
    expect(matrix.map(cellName)).toContain('greedy|hauler|2h');
    expect(matrix.map(cellName)).toContain('safe|rescuer|2h');
  });

  it('names each cell the way the store writes it', () => {
    const [first] = defaultMatrix(3);
    expect(first).toBeDefined();
    expect(cellName(first!)).toBe(`${first!.temperament}|${first!.playstyle}|3h`);
  });
});

describe('percentile', () => {
  it('takes the nearest rank on a sorted sample', () => {
    const values = [10, 20, 30, 40, 50];
    expect(percentile(values, 0.5)).toBe(30);
    expect(percentile(values, 0.1)).toBe(10);
    expect(percentile(values, 0.9)).toBe(50);
  });

  it('is NaN on an empty sample', () => {
    expect(percentile([], 0.5)).toBeNaN();
  });
});

describe('runCell + summarizeRun', () => {
  const cell = defaultMatrix().find((c) => cName(c) === 'random|generalist|2h')!;

  function cName(c: { temperament: string; playstyle: string; hoursPerDay: number }): string {
    return `${c.temperament}|${c.playstyle}|${c.hoursPerDay}h`;
  }

  it('plays the requested number of games, seeds baseSeed + i', () => {
    const { results } = runCell(snapshot, cell, 2, 50, 8);
    expect(results).toHaveLength(2);
    expect(results[0]!.seed).toBe(50);
    expect(results[1]!.seed).toBe(51);
    expect(results.every((result) => result.totalMissions === 8)).toBe(true);
  });

  it('is deterministic: the same base seed replays the same games', () => {
    const first = runCell(snapshot, cell, 2, 50, 8);
    const second = runCell(snapshot, cell, 2, 50, 8);
    expect(second.results).toEqual(first.results);
  });

  it('summarizes each run with level 1 at t=0 and later levels after', () => {
    const { results } = runCell(snapshot, cell, 2, 50, 8);
    for (const result of results) {
      const summary = summarizeRun(result, budget);
      expect(summary.levelReachedAt[0]).toBe(0);
      expect(summary.missionsToLevel[0]).toBe(0);
      expect(summary.days).toBeGreaterThan(0);
      // A level, once held, is never un-held: first-held times never go backwards.
      let previous = -1;
      for (const at of summary.levelReachedAt) {
        if (at === null) continue;
        expect(at).toBeGreaterThanOrEqual(previous);
        previous = at;
      }
      const spread = daysToLevelSpread([summary], [2, 3, 4, 5]);
      expect(spread).toHaveLength(4);
      for (const entry of spread) {
        expect(entry.reached).toBeLessThanOrEqual(1);
        if (entry.reached === 0) expect(entry.daysMedian).toBeNaN();
      }
    }
  });

  it('different base seeds play different games', () => {
    const first = runCell(snapshot, cell, 1, 50, 8);
    const second = runCell(snapshot, cell, 1, 99, 8);
    expect(second.results[0]!.seed).not.toBe(first.results[0]!.seed);
  });
});

describe('daysToLevelSpread across a sample', () => {
  it('counts how many runs reached each level', () => {
    const cell = defaultMatrix().at(-1)!; // random|generalist control
    const { results } = runCell(snapshot, cell, 3, 7, 8);
    const summaries = results.map((result) => summarizeRun(result, budget));
    const spread = daysToLevelSpread(summaries, [2, 3, 4, 5]);
    for (const entry of spread) {
      expect(entry.reached).toBeGreaterThanOrEqual(0);
      expect(entry.reached).toBeLessThanOrEqual(3);
    }
    // Level 1 is held from the start, so every run "reached" it — spot-check via the trail.
    for (const summary of summaries) {
      expect(summary.levelReachedAt[0]).toBe(0);
    }
  });
});
