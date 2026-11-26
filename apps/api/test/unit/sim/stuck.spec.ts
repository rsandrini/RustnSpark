/**
 * The stuck handler: a refuel only counts as an unlock when a tank can hold the need and the pump
 * adds fuel; a hop for work skips ports found empty lately; the tow cap counts tows in a row
 * without work, not tows over the whole run.
 */
import { describe, expect, it } from '@jest/globals';
import {
  EMPTY_PORT_MEMORY_TURNS,
  EmptyPortMemory,
  isRealUnlock,
  pickWorkPort,
  TOWS_WITHOUT_WORK_MAX,
  TowBudget,
} from '../../../sim/bots/stuck.js';
import { fullTankCost, refuelQuote } from '../../../sim/actions/fuel.js';
import { fuelCapOf } from '../../../sim/core/fleet.js';
import { catalogIndex, starterPlayer } from '../../../sim/core/state.js';
import { fixtureSnapshot } from './fixture.js';

describe('isRealUnlock', () => {
  it('is true when the need fits the tank and the pump adds fuel', () => {
    expect(isRealUnlock(300, 100, 375, 200)).toBe(true);
  });

  it('is false when even a full tank is short of the need (the cinder loop)', () => {
    expect(isRealUnlock(420, 375, 375, 0)).toBe(false);
    expect(isRealUnlock(420, 100, 375, 275)).toBe(false);
  });

  it('is false when the pump adds nothing or the fuel is already aboard', () => {
    expect(isRealUnlock(300, 100, 375, 0)).toBe(false);
    expect(isRealUnlock(100, 100, 375, 50)).toBe(false);
  });
});

describe('pickWorkPort', () => {
  const ports = [
    { locationId: 'cinder', factor: 0.9 },
    { locationId: 'ziggy', factor: 1.0 },
    { locationId: 'ceres', factor: 1.2 },
  ];

  it('never picks the current port and prefers the cheapest fresh one', () => {
    const memory = new EmptyPortMemory();
    expect(pickWorkPort(ports, 'cinder', memory)).toBe('ziggy');
  });

  it('skips a port found empty lately, so two quiet neighbours do not ping-pong', () => {
    const memory = new EmptyPortMemory();
    memory.markEmpty('ziggy');
    expect(pickWorkPort(ports, 'cinder', memory)).toBe('ceres');
  });

  it('with every port empty lately, goes to the one tried longest ago', () => {
    const memory = new EmptyPortMemory();
    memory.markEmpty('ceres');
    memory.tick();
    memory.markEmpty('ziggy');
    expect(pickWorkPort(ports, 'cinder', memory)).toBe('ceres');
  });

  it('forgets an empty port after a while, and at once when work is found there', () => {
    const memory = new EmptyPortMemory();
    memory.markEmpty('ziggy');
    for (let turn = 0; turn <= EMPTY_PORT_MEMORY_TURNS; turn += 1) memory.tick();
    expect(memory.isFresh('ziggy')).toBe(true);
    memory.markEmpty('ceres');
    memory.markWorked('ceres');
    expect(memory.isFresh('ceres')).toBe(true);
  });

  it('returns null when only the current port is reachable', () => {
    expect(
      pickWorkPort([{ locationId: 'cinder', factor: 1 }], 'cinder', new EmptyPortMemory()),
    ).toBe(null);
  });
});

describe('TowBudget', () => {
  it('is exhausted after the cap of tows in a row with no work', () => {
    const budget = new TowBudget();
    for (let tow = 0; tow < TOWS_WITHOUT_WORK_MAX; tow += 1) {
      expect(budget.exhausted).toBe(false);
      budget.onTow();
    }
    expect(budget.exhausted).toBe(true);
  });

  it('a mission flown between tows resets the count, not the total', () => {
    const budget = new TowBudget();
    budget.onTow();
    budget.onTow();
    budget.onWork();
    budget.onTow();
    budget.onTow();
    expect(budget.exhausted).toBe(false);
    expect(budget.towsTotal).toBe(4);
  });
});

describe('fullTankCost (the spend plan fuel reserve)', () => {
  const snapshot = fixtureSnapshot();
  const catalogByType = catalogIndex(snapshot);

  it('prices a whole tank even when the tank is already full', () => {
    const state = starterPlayer(snapshot, 'luna');
    const fuelCap = fuelCapOf(state, catalogByType, snapshot.rules);
    state.ship.fuel = 0;
    const fromEmpty = refuelQuote(state, snapshot, snapshot.rules, catalogByType, state.locationId);
    state.ship.fuel = fuelCap;
    const gap = refuelQuote(state, snapshot, snapshot.rules, catalogByType, state.locationId);
    expect(gap.cost).toBe(0);
    expect(fullTankCost(state, snapshot, snapshot.rules, catalogByType, state.locationId)).toBe(
      fromEmpty.cost,
    );
    expect(fromEmpty.cost).toBeGreaterThan(0);
  });
});
