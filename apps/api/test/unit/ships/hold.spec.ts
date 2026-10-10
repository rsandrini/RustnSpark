import { describe, expect, it } from '@jest/globals';
import { computeHold, withHoldProblem } from '../../../src/ships/hold.js';

describe('the ship hold', () => {
  it('spare parts ride free inside the bridge slots; only the surplus takes cargo space', () => {
    const hold = computeHold({ slots: 6, partCells: 4, ore: 0, capacity: 5 });
    expect(hold).toMatchObject({ used: 0, free: 5, over: false });
    const more = computeHold({ slots: 6, partCells: 9, ore: 0, capacity: 5 });
    expect(more).toMatchObject({ used: 3, free: 2, over: false });
  });

  it('ore always takes cargo space, and a load past the cargo space is over', () => {
    expect(computeHold({ slots: 6, partCells: 0, ore: 5, capacity: 5 }).over).toBe(false);
    const over = computeHold({ slots: 6, partCells: 8, ore: 5, capacity: 5 });
    expect(over).toMatchObject({ used: 7, free: 0, over: true });
  });

  it('adds a blocking problem to the viability report only when over', () => {
    const report = { viable: true, problems: [], warnings: [] };
    expect(withHoldProblem(report, computeHold({ slots: 6, partCells: 0, ore: 0, capacity: 5 }))).toBe(
      report,
    );
    const blocked = withHoldProblem(
      report,
      computeHold({ slots: 0, partCells: 9, ore: 0, capacity: 5 }),
    );
    expect(blocked.viable).toBe(false);
    expect(blocked.problems.map((problem) => problem.code)).toEqual(['HOLD_OVER_CAPACITY']);
  });
});
