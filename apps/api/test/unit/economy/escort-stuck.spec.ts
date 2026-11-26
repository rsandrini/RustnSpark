import { describe, expect, it } from '@jest/globals';
import { fuelToLeave, isStuck, type StuckInput } from '../../../src/economy/escort-stuck.js';

// "Stuck" for the escort (owner, 2026-11-25): the pilot cannot get out on their own. An empty tank
// alone is not that when the port sells fuel and the wallet pays for the cheapest way out.
const flying: StuckInput = {
  credits: 1000,
  hullCannotFly: false,
  fuelUse: 10,
  fuel: 50,
  sellsFuel: true,
  costToLeave: 30,
};

describe('escort: who is stuck', () => {
  it('a pilot with fuel, money and a ship that flies is not stuck', () => {
    expect(isStuck(flying)).toBe(false);
  });

  it('zero fuel and money enough to buy the way out is not stuck', () => {
    expect(isStuck({ ...flying, fuel: 0, credits: 30 })).toBe(false);
  });

  it('zero fuel and not enough money for the way out is stuck', () => {
    expect(isStuck({ ...flying, fuel: 0, credits: 29 })).toBe(true);
    expect(isStuck({ ...flying, fuel: 0, credits: 0 })).toBe(true);
  });

  it('zero fuel at a port that sells no fuel is stuck, whatever the money', () => {
    expect(isStuck({ ...flying, fuel: 0, credits: 1_000_000, sellsFuel: false })).toBe(true);
  });

  it('a ship that burns no fuel is never stuck for want of it', () => {
    expect(isStuck({ ...flying, fuelUse: 0, fuel: 0, credits: 0, sellsFuel: false })).toBe(false);
  });

  it('debt is stuck, even with a full tank', () => {
    expect(isStuck({ ...flying, credits: -1 })).toBe(true);
  });

  it('a hull that cannot fly is stuck, even with money and fuel', () => {
    expect(isStuck({ ...flying, hullCannotFly: true })).toBe(true);
  });
});

describe('escort: fuel to leave a place', () => {
  it('is the burn of the cheapest route out, with its harshest environment', () => {
    const routes = [
      { distance: 200, envFuelMult: 1 },
      { distance: 100, envFuelMult: 1.5 },
      { distance: 300, envFuelMult: 1 },
    ];
    // fuelUse 10 per 100 distance: 20, 15, 30 -> 15.
    expect(fuelToLeave(10, routes)).toBe(15);
  });

  it('is at least one unit (no routes, or a burn that rounds to zero)', () => {
    expect(fuelToLeave(10, [])).toBe(1);
    expect(fuelToLeave(1, [{ distance: 10, envFuelMult: 1 }])).toBe(1);
  });
});
