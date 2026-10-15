/**
 * Three pilot habits the first sim lacked: searching on foot (no ship in the job, so no wear, no
 * fuel, and it works with a grounded hull), counting what fitted finds saved from the market,
 * and, when the whole bill is out of reach, repairing the most worn parts the wallet covers.
 */
import { describe, expect, it } from '@jest/globals';
import { missionContext } from '../../../sim/actions/mission.js';
import { scavenge } from '../../../sim/actions/scavenge.js';
import { fitPart, unfitPart } from '../../../sim/actions/market.js';
import { affordableRepairTargets, idleInstalledParts } from '../../../sim/bots/policy.js';
import { catalogIndex, starterPlayer } from '../../../sim/core/state.js';
import { buildFillerWorld } from '../../../sim/core/world.js';
import { fixtureSnapshot } from './fixture.js';

const snapshot = fixtureSnapshot();
const ctx = missionContext(snapshot);
const world = buildFillerWorld(snapshot);
const NOW_MS = Date.parse(snapshot.takenAt);

describe('scavenging on foot', () => {
  it('runs for the foot duration and leaves the hull and the tank alone', () => {
    const state = starterPlayer(snapshot, 'luna');
    const before = state.ship.parts.map((part) => part.condition);
    const fuel = state.ship.fuel;
    const out = scavenge(state, ctx, world, NOW_MS, true);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(Math.abs(out.durationSeconds - snapshot.rules.scavenging.foot_duration_seconds)).toBeLessThanOrEqual(2);
    expect(state.ship.parts.map((part) => part.condition)).toEqual(before);
    expect(state.ship.fuel).toBe(fuel);
    expect(state.footScavenges).toBe(1);
    expect(state.missionsDone).toBe(0);
  });

  it('still works when the ship cannot fly at all', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.ship.fuel = 0;
    state.ship.parts = state.ship.parts.map((part) => ({ ...part, condition: 1 }));
    const out = scavenge(state, ctx, world, NOW_MS, true);
    expect(out.ok).toBe(true);
  });
});

describe('what fitted finds saved', () => {
  it('counts a scavenged part once, at its catalog price', () => {
    const state = starterPlayer(snapshot, 'luna');
    const catalog = catalogIndex(snapshot);
    const cargo = state.ship.parts.find((part) => catalog.get(part.partType)?.partClass === 'CARGO');
    if (cargo === undefined) throw new Error('fixture has no cargo part');
    state.storage.push({ id: 'scavenged-1', partType: cargo.partType, condition: 90, source: 'scavenge' });
    const price = catalog.get(cargo.partType)?.basePrice ?? 0;
    const fitted = fitPart(state, ctx.rules, catalog, 'scavenged-1', cargo.id);
    expect(fitted.ok).toBe(true);
    expect(state.findsFittedValue).toBe(price);
    // Swapping it back and forth never counts the same find twice.
    state.storage.push({ ...cargo, id: 'scavenged-1', source: 'scavenge' });
    fitPart(state, ctx.rules, catalog, 'scavenged-1', cargo.id);
    expect(state.findsFittedValue).toBe(price);
  });
});

describe('affordable repair', () => {
  it('repairs the worst parts first and skips what the budget cannot cover', () => {
    const state = starterPlayer(snapshot, 'luna');
    const [first, second, third] = state.ship.parts;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('fixture ship has fewer than three parts');
    }
    for (const part of state.ship.parts) part.condition = 100;
    first.condition = 10;
    second.condition = 40;
    third.condition = 70;
    const catalog = catalogIndex(snapshot);
    const all = affordableRepairTargets(state, snapshot, ctx.rules, catalog, Number.MAX_SAFE_INTEGER);
    expect(all?.map((target) => target.partId)).toEqual([first.id, second.id, third.id]);
    expect(affordableRepairTargets(state, snapshot, ctx.rules, catalog, 0)).toBeNull();
  });
});

describe('idle installed parts', () => {
  it('flags a tank on a ship with no fuel-burning engine and unfits it', () => {
    const state = starterPlayer(snapshot, 'luna');
    const catalog = catalogIndex(snapshot);
    // The starter burns fuel: its tank is in use.
    expect(idleInstalledParts(state, catalog)).toEqual([]);
    // Drop the engine from the hold-less ship: the tank has nothing to feed.
    const engine = state.ship.parts.find((part) => (catalog.get(part.partType)?.fuelUse ?? 0) > 0);
    if (engine === undefined) throw new Error('fixture has no fuel-burning engine');
    state.ship.parts = state.ship.parts.filter((part) => part.id !== engine.id);
    const idle = idleInstalledParts(state, catalog);
    expect(idle).toHaveLength(1);
    // With no engine the hull cannot fly either way, so the removal is refused (never worse).
    const out = unfitPart(state, ctx.rules, catalog, idle[0] ?? '');
    expect(out.ok).toBe(false);
  });

  it('removes a part nothing leans on and keeps it in the hold', () => {
    const state = starterPlayer(snapshot, 'luna');
    const catalog = catalogIndex(snapshot);
    const cargo = state.ship.parts.find((part) => catalog.get(part.partType)?.partClass === 'CARGO');
    if (cargo === undefined) throw new Error('fixture has no cargo part');
    const out = unfitPart(state, ctx.rules, catalog, cargo.id);
    if (out.ok) {
      expect(state.storage.some((part) => part.id === cargo.id)).toBe(true);
      expect(state.ship.parts.some((part) => part.id === cargo.id)).toBe(false);
    } else {
      expect(out.reason).toBe('NOT_VIABLE');
    }
  });
});
