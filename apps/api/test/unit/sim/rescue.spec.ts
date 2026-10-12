/**
 * Rescue: the tow a stranded pilot pays for, priced by the game's own `rescuePrices`. It is the
 * one debit allowed to drive the wallet negative, it tops the tank only up to the emergency
 * ration, and it never sells or installs a part — a tow buys safety, not a new build.
 */
import { describe, expect, it } from '@jest/globals';
import { rescuePrices } from '../../../src/ships/floating.js';
import { rescue } from '../../../sim/actions/rescue.js';
import { fuelCapOf } from '../../../sim/core/fleet.js';
import { catalogIndex, starterPlayer } from '../../../sim/core/state.js';
import { fixtureSnapshot } from './fixture.js';

const snapshot = fixtureSnapshot();
const rules = snapshot.rules;
const catalogByType = catalogIndex(snapshot);

describe('rescue', () => {
  it('charges the exact rescuePrices(0).now fee, even underwater', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.ship.fuel = 10;
    state.wallet = 200;
    const expected = rescuePrices(0, rules).now;
    const out = rescue(state, snapshot, rules, catalogByType);
    expect(out.cost).toBe(expected);
    // 200 credits cannot cover the tow — rescue is the debit that may go negative.
    expect(state.wallet).toBe(200 - expected);
    expect(state.ledger.totals().rescue).toBe(-expected);
    expect(out.underwater).toBe(true);
  });

  it('tops the tank to the emergency ration and never lowers it', () => {
    const state = starterPlayer(snapshot, 'luna');
    const fuelCap = fuelCapOf(state, catalogByType, rules);
    const ration = Math.round(fuelCap * rules.economy.rescue_fuel_fraction);

    state.ship.fuel = 10;
    const dry = rescue(state, snapshot, rules, catalogByType);
    expect(dry.fuelAfter).toBe(ration);
    expect(dry.rationAdded).toBe(ration - 10);

    // A tank already above the ration keeps what it holds: rescue never empties a ship.
    state.ship.fuel = ration + 50;
    const topped = rescue(state, snapshot, rules, catalogByType);
    expect(topped.fuelAfter).toBe(ration + 50);
    expect(topped.rationAdded).toBe(0);
  });

  it('keeps every installed part — a tow buys safety, not a new build', () => {
    const state = starterPlayer(snapshot, 'luna');
    const before = structuredClone(state.ship.parts);
    rescue(state, snapshot, rules, catalogByType);
    expect(state.ship.parts).toEqual(before);
  });
});
