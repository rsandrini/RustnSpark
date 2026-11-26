import { describe, it, expect } from 'vitest';
import { holdFigureOf, missionLoadUnits } from './hold-load';

describe('missionLoadUnits (the server rule: cargoLoadFor)', () => {
  it('loads nothing for a delivery that only needs room, or a mission without cargo terms', () => {
    expect(missionLoadUnits({ mode: 'min', need: 10 }, 40)).toBe(0);
    expect(missionLoadUnits(null, 40)).toBe(0);
    expect(missionLoadUnits(undefined, 40)).toBe(0);
  });
  it('a fixed load is what the mission names, capped at the hold', () => {
    expect(missionLoadUnits({ mode: 'fixed', need: 12 }, 40)).toBe(12);
    expect(missionLoadUnits({ mode: 'fixed', need: 60 }, 40)).toBe(40);
  });
  it('an open load fills the whole hold', () => {
    expect(missionLoadUnits({ mode: 'open', need: 10 }, 40)).toBe(40);
  });
});

describe('holdFigureOf', () => {
  it('a delivery counts its cargo units against the hold', () => {
    const info = { cargo: { mode: 'fixed' as const, need: 8 } };
    expect(holdFigureOf({ type: 'DELIVERY', info }, 10)).toEqual({
      kind: 'cargo',
      used: 8,
      capacity: 10,
    });
  });
  it('a mining run shows its ore space, or nothing without a rig', () => {
    expect(holdFigureOf({ type: 'MINING', info: { mining: { spaceUnits: 20 } } }, 10)).toEqual({
      kind: 'ore',
      space: 20,
    });
    expect(holdFigureOf({ type: 'MINING', info: { mining: null } }, 10)).toBeNull();
  });
});
