import { describe, expect, it } from '@jest/globals';
import { deriveSheet } from '../../../src/ships/sheet.deriver.js';
import {
  catalogIndex,
  homeLocationOf,
  installedParts,
  starterPlayer,
  wearPoints,
} from '../../../sim/core/state.js';
import { fixtureSnapshot } from './fixture.js';

const snapshot = fixtureSnapshot();

describe('starterPlayer', () => {
  it('homes the faction, credits the wallet and fills the tank', () => {
    const state = starterPlayer(snapshot, 'luna');
    expect(state.locationId).toBe('ceres');
    expect(state.wallet).toBe(snapshot.rules.economy.start_credits);
    const condition = snapshot.rules.parts.starter_condition;
    expect(state.ship.parts.map((part) => part.partType)).toEqual([
      'bridge',
      'engine_chem_small',
      'tank_small',
      'cargo',
      'hull',
    ]);
    expect(state.ship.parts.every((part) => part.condition === condition)).toBe(true);
    const sheet = deriveSheet(installedParts(state.ship, catalogIndex(snapshot)), snapshot.rules);
    expect(state.ship.fuel).toBe(sheet.fuelCap);
    expect(sheet.fuelCap).toBe(300);
    expect(state.missionsDone).toBe(0);
    expect(state.storage).toEqual([]);
  });

  it('rejects an unplayable faction', () => {
    expect(() => homeLocationOf(snapshot, 'pirates')).toThrow(/not playable/);
  });
});

describe('wearPoints', () => {
  it('sums the condition each installed part lost', () => {
    const before = [
      { id: 'a', partType: 'hull', condition: 100 },
      { id: 'b', partType: 'cargo', condition: 80 },
    ];
    const after = [
      { id: 'a', partType: 'hull', condition: 85 },
      { id: 'b', partType: 'cargo', condition: 80 },
    ];
    expect(wearPoints(before, after)).toBe(15);
  });
});
