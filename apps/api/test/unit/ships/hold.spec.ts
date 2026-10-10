import { describe, expect, it } from '@jest/globals';
import { computeHold, withHoldProblem } from '../../../src/ships/hold.js';

describe('the ship hold', () => {
  it('spare parts take one bridge slot each, whatever their size or rarity', () => {
    expect(computeHold({ slots: 8, parts: 8, capacity: 5 })).toMatchObject({
      partsOver: false,
      over: false,
    });
    expect(computeHold({ slots: 8, parts: 9, capacity: 5 })).toMatchObject({
      partsOver: true,
      over: true,
    });
  });

  it('spare parts never touch the cargo space: only the mission cargo does', () => {
    expect(computeHold({ slots: 8, parts: 8, capacity: 5, missionCargo: 5 })).toMatchObject({
      used: 5,
      free: 0,
      cargoOver: false,
      over: false,
    });
    expect(computeHold({ slots: 8, parts: 0, capacity: 5, missionCargo: 6 })).toMatchObject({
      cargoOver: true,
      over: true,
    });
  });

  it('adds a blocking problem for each way the load does not fit, none when it fits', () => {
    const report = { viable: true, problems: [], warnings: [] };
    expect(withHoldProblem(report, computeHold({ slots: 8, parts: 1, capacity: 5 }))).toBe(report);
    const blocked = withHoldProblem(
      report,
      computeHold({ slots: 2, parts: 3, capacity: 5, missionCargo: 9 }),
    );
    expect(blocked.viable).toBe(false);
    expect(blocked.problems.map((problem) => problem.code)).toEqual([
      'HOLD_PARTS_OVER',
      'HOLD_OVER_CAPACITY',
    ]);
  });
});
