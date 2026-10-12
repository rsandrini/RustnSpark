/**
 * Phase 2: fuel and repair cost real money and time, bought at the right ports. These tests pin
 * the decisions that make "net profit per mission" honest — that the wallet is debited by the
 * exact amount the game's own calculator returns, that the bot only repairs when the plan's
 * thresholds say so, that an unarmed ship refuses the danger it cannot fight, and that a pilot
 * with no work in hand can buy their way to a port that has some.
 */
import { describe, expect, it } from '@jest/globals';
import { refuel, refuelQuote } from '../../../sim/actions/fuel.js';
import { repair, repairQuote } from '../../../sim/actions/repair.js';
import {
  averageConditionOf,
  minConditionOf,
  minKeyConditionOf,
  portFactor,
  reachablePorts,
  repairSecondsAt,
} from '../../../sim/core/fleet.js';
import { catalogIndex, starterPlayer } from '../../../sim/core/state.js';
import { buildFillerWorld, type Offer } from '../../../sim/core/world.js';
import {
  CHEAP_PORT_TOLERANCE,
  REPAIR_AVG_THRESHOLD,
  REPAIR_KEY_THRESHOLD,
  cheapPortsOf,
  decideDanger,
  decideFuel,
  decideRepair,
  hasDefensePart,
  isShipGrounded,
  needsRepair,
  repositionOffer,
} from '../../../sim/bots/policy.js';
import { fixtureSnapshot } from './fixture.js';

const snapshot = fixtureSnapshot();
const rules = snapshot.rules;
const catalogByType = catalogIndex(snapshot);

/** The fixture's three ports, cheapest first: ceres/tycho at isolation 0.9, vesta at 1.0. */
const CHEAP_PORT = 'ceres';
const ALSO_CHEAP_PORT = 'tycho';
const EXPENSIVE_PORT = 'vesta';

describe('port factors and reachability', () => {
  it('classifies the fixture ports by isolation: 0.9 is cheap, 1.0 is expensive', () => {
    const state = starterPlayer(snapshot, 'luna');
    const { current, cheapest, reachable } = cheapPortsOf(
      state,
      snapshot,
      rules,
      catalogByType,
    );
    // All three are on one tank of fuel, so all three are reachable.
    expect(reachable.map((port) => port.locationId).sort()).toEqual([
      CHEAP_PORT,
      ALSO_CHEAP_PORT,
      EXPENSIVE_PORT,
    ]);
    expect(cheapest.factor).toBeCloseTo(0.9, 5);
    // Standing at ceres (0.9), within 10% of the cheapest, the current port is cheap.
    expect(current.locationId).toBe(CHEAP_PORT);
    expect(current.isCheap).toBe(true);
  });

  it('marks vesta expensive: its factor is more than 10% above the cheapest', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.locationId = EXPENSIVE_PORT;
    const { current } = cheapPortsOf(state, snapshot, rules, catalogByType);
    // 1.0 / 0.9 ≈ 1.111 > 1 + 0.1.
    expect(current.factor).toBeCloseTo(portFactor(snapshot, rules, EXPENSIVE_PORT, 'luna'), 5);
    expect(current.isCheap).toBe(false);
  });

  it('reaches every fixture port on the starter tank', () => {
    const state = starterPlayer(snapshot, 'luna');
    const reached = reachablePorts(state, snapshot, rules, catalogByType);
    expect(reached.sort()).toEqual([CHEAP_PORT, ALSO_CHEAP_PORT, EXPENSIVE_PORT]);
  });
});

describe('refuel', () => {
  it('fills the tank at the exact refuelCost figure the game returns', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.ship.fuel = 0;
    state.wallet = 10_000;
    const walletBefore = state.wallet;
    const expected = refuelQuote(state, snapshot, rules, catalogByType, CHEAP_PORT);
    const result = refuel(state, snapshot, rules, catalogByType, CHEAP_PORT);
    expect(result.units).toBeGreaterThan(0);
    expect(result.cost).toBe(expected.cost);
    expect(state.wallet).toBe(walletBefore - expected.cost);
    expect(state.ledger.total('fuel')).toBe(-expected.cost);
    expect(state.ship.fuel).toBe(result.units);
  });

  it('caps the purchase at the tank: never refuels past fuelCap', () => {
    const state = starterPlayer(snapshot, 'luna');
    const cap = state.ship.fuel;
    state.ship.fuel = cap - 10;
    const result = refuel(state, snapshot, rules, catalogByType, CHEAP_PORT);
    expect(result.units).toBe(10);
    expect(state.ship.fuel).toBe(cap);
  });

  it('buys nothing (and charges nothing) when the tank is already full', () => {
    const state = starterPlayer(snapshot, 'luna');
    const walletBefore = state.wallet;
    const result = refuel(state, snapshot, rules, catalogByType, CHEAP_PORT);
    expect(result.units).toBe(0);
    expect(result.cost).toBe(0);
    expect(state.wallet).toBe(walletBefore);
  });

  it('refuses to refuel a ship that is not in port', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.locationId = EXPENSIVE_PORT;
    expect(() => refuel(state, snapshot, rules, catalogByType, CHEAP_PORT)).toThrow(/at ceres/);
  });
});

describe('repair', () => {
  it('charges the exact repairCost figure and advances the clock by points × seconds/point', () => {
    const state = starterPlayer(snapshot, 'luna');
    // Wear the ship out so a repair is real: every part down to 50.
    for (const part of state.ship.parts) part.condition = 50;
    state.wallet = 10_000;
    const walletBefore = state.wallet;
    const clockBefore = state.clock.now();
    const expected = repairQuote(state, snapshot, rules, catalogByType, CHEAP_PORT);
    const result = repair(state, snapshot, rules, catalogByType, CHEAP_PORT);
    const points = state.ship.parts.length * 50;
    expect(result.points).toBe(points);
    expect(result.cost).toBe(expected.cost);
    expect(state.wallet).toBe(walletBefore - expected.cost);
    expect(state.ledger.total('repair')).toBe(-expected.cost);
    expect(state.clock.now() - clockBefore).toBe(points * repairSecondsAt(snapshot, rules, CHEAP_PORT));
    expect(state.ship.parts.every((part) => part.condition === 100)).toBe(true);
  });

  it('does nothing (and charges nothing) on a healthy ship', () => {
    const state = starterPlayer(snapshot, 'luna');
    // The starter kit ships at starter_condition (85), so "healthy" for a no-op repair means 100.
    for (const part of state.ship.parts) part.condition = 100;
    const walletBefore = state.wallet;
    const clockBefore = state.clock.now();
    const result = repair(state, snapshot, rules, catalogByType, CHEAP_PORT);
    expect(result.points).toBe(0);
    expect(result.cost).toBe(0);
    expect(state.wallet).toBe(walletBefore);
    expect(state.clock.now()).toBe(clockBefore);
  });

  it('refuses to repair a ship that is not in port', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.locationId = EXPENSIVE_PORT;
    for (const part of state.ship.parts) part.condition = 10;
    expect(() => repair(state, snapshot, rules, catalogByType, CHEAP_PORT)).toThrow(/at ceres/);
  });
});

describe('needsRepair (the plan thresholds)', () => {
  it('leaves a healthy ship alone', () => {
    const state = starterPlayer(snapshot, 'luna');
    expect(averageConditionOf(state)).toBeGreaterThanOrEqual(REPAIR_AVG_THRESHOLD);
    expect(minKeyConditionOf(state, catalogByType)).toBeGreaterThanOrEqual(REPAIR_KEY_THRESHOLD);
    expect(needsRepair(state, catalogByType)).toBe(false);
  });

  it('repairs when the average condition drops below the average threshold', () => {
    const state = starterPlayer(snapshot, 'luna');
    for (const part of state.ship.parts) part.condition = REPAIR_AVG_THRESHOLD - 1;
    expect(averageConditionOf(state)).toBeLessThan(REPAIR_AVG_THRESHOLD);
    expect(needsRepair(state, catalogByType)).toBe(true);
  });

  it('repairs when a key part drops below the key threshold, even if the average is fine', () => {
    const state = starterPlayer(snapshot, 'luna');
    const engine = state.ship.parts.find(
      (part) => catalogByType.get(part.partType)?.partClass === 'ENGINE',
    );
    expect(engine).toBeDefined();
    if (engine === undefined) return;
    engine.condition = REPAIR_KEY_THRESHOLD - 1;
    // The average is still healthy — only the key part is worn.
    expect(averageConditionOf(state)).toBeGreaterThanOrEqual(REPAIR_AVG_THRESHOLD);
    expect(minConditionOf(state)).toBe(REPAIR_KEY_THRESHOLD - 1);
    expect(needsRepair(state, catalogByType)).toBe(true);
  });
});

describe('isShipGrounded (the board’s own refusal)', () => {
  it('leaves a healthy ship alone', () => {
    const state = starterPlayer(snapshot, 'luna');
    expect(isShipGrounded(state, rules, catalogByType)).toBe(false);
  });

  it('grounds a hull whose tank is dead — condition 1, above the old <= 0 line', () => {
    // dead_at_or_below is 1: a tank worn to 1 holds no fuel, so the derived sheet loses its
    // fuel capacity and the resolver refuses every mission with SHIP_NOT_VIABLE. The old
    // condition-only rule (minCondition <= 0) never fired, so the repair policy never ran and
    // the run sat grounded until the rescue cap — this is the exact failure it caused.
    const state = starterPlayer(snapshot, 'luna');
    const tank = state.ship.parts.find((part) => part.partType === 'tank_small');
    if (tank === undefined) throw new Error('fixture ship has no tank');
    tank.condition = 1;
    expect(minConditionOf(state)).toBe(1);
    expect(isShipGrounded(state, rules, catalogByType)).toBe(true);
  });

  it('grounds a hull that cannot move or a key part near dead, whatever the rest looks like', () => {
    const noEngine = starterPlayer(snapshot, 'luna');
    noEngine.ship.parts = noEngine.ship.parts.filter((part) => part.partType !== 'engine_chem_small');
    expect(isShipGrounded(noEngine, rules, catalogByType)).toBe(true);

    const wornKey = starterPlayer(snapshot, 'luna');
    const engine = wornKey.ship.parts.find((part) => part.partType === 'engine_chem_small');
    if (engine === undefined) throw new Error('fixture ship has no engine');
    engine.condition = 3;
    expect(isShipGrounded(wornKey, rules, catalogByType)).toBe(true);
  });
});

describe('decideRepair (where to repair)', () => {
  it('repairs a worn ship at a cheap port, right there', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.locationId = CHEAP_PORT;
    for (const part of state.ship.parts) part.condition = REPAIR_AVG_THRESHOLD - 1;
    const decision = decideRepair(state, snapshot, rules, catalogByType);
    expect(decision.shouldRepair).toBe(true);
    expect(decision.reason).toBe('cheap-port-threshold');
  });

  it('sends a worn ship at an expensive port to the cheapest reachable port', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.locationId = EXPENSIVE_PORT;
    for (const part of state.ship.parts) part.condition = REPAIR_AVG_THRESHOLD - 1;
    const decision = decideRepair(state, snapshot, rules, catalogByType);
    expect(decision.shouldRepair).toBe(false);
    expect(decision.reason).toBe('travel-to-cheap-repair');
  });

  it('leaves a healthy ship alone wherever it stands', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.locationId = EXPENSIVE_PORT;
    const decision = decideRepair(state, snapshot, rules, catalogByType);
    expect(decision.shouldRepair).toBe(false);
    expect(decision.reason).toBe('healthy');
  });
});

describe('decideFuel (how much to buy)', () => {
  it('fills the tank at a cheap port', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.locationId = CHEAP_PORT;
    state.ship.fuel = 50;
    const decision = decideFuel(state, snapshot, rules, catalogByType, null);
    expect(decision.shouldRefuel).toBe(true);
    expect(decision.units).toBeUndefined();
    expect(decision.reason).toBe('cheap-port-fill');
  });

  it('buys nothing at an expensive port when the next mission is already covered', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.locationId = EXPENSIVE_PORT;
    // Below the 300 cap (so there is a gap to fill) but enough to reach tycho (~21 units for
    // 300 distance), making the cheap baseline 0.9 and vesta (1.0) genuinely expensive.
    state.ship.fuel = 250;
    // No next offer given, and the port is expensive: nothing to buy for.
    const decision = decideFuel(state, snapshot, rules, catalogByType, null);
    expect(decision.shouldRefuel).toBe(false);
    expect(decision.reason).toBe('no-next-mission');
  });
});

describe('CHEAP_PORT_TOLERANCE', () => {
  it('is 10%, as the plan specifies', () => {
    expect(CHEAP_PORT_TOLERANCE).toBeCloseTo(0.1, 5);
  });
});

/** A one-leg offer with the given peak danger and distance, leaving `EXPENSIVE_PORT`. */
function offerAt(danger: number, distance = 500): Offer {
  return {
    id: 'offer-test',
    seed: 'offer-test',
    templateId: 'delivery_luna',
    type: 'DELIVERY',
    factionId: 'luna',
    originId: EXPENSIVE_PORT,
    destinationId: CHEAP_PORT,
    legs: [
      {
        routeId: 'vesta-ceres',
        distance,
        danger,
        zone: 1,
        env: { id: 'open', level: 1, fuelMult: 1 },
      },
    ],
    cargo: {},
    reward: 100,
    expiresAtMs: 0,
    deadlineAtMs: null,
    starter: false,
    requirements: {},
    encounterPolicy: {},
  };
}

describe('decideFuel (the "no other way" rule)', () => {
  it('buys the shortfall at an expensive port when only that fuel can fly the next mission', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.locationId = EXPENSIVE_PORT;
    state.ship.fuel = 50;
    // fuelUse 7 × distance 1000 / 100 = 70 units needed, 50 in the tank: 20 short, and at
    // vesta's price — there is no cheaper way to fly this job than to buy it here.
    const decision = decideFuel(state, snapshot, rules, catalogByType, offerAt(1, 1000));
    expect(decision).toEqual({
      shouldRefuel: true,
      units: 20,
      reason: 'expensive-port-minimum',
    });
  });

  it('buys nothing when the tank already covers the next mission', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.locationId = EXPENSIVE_PORT;
    state.ship.fuel = 50;
    const decision = decideFuel(state, snapshot, rules, catalogByType, offerAt(1, 400));
    expect(decision).toEqual({ shouldRefuel: false, reason: 'enough-for-next' });
  });
});

describe('decideDanger (the unarmed ceiling)', () => {
  it('does not count the starter hull as protection', () => {
    const state = starterPlayer(snapshot, 'luna');
    // The catalog classes the hull DEFENSE, but its esc is 0 — structure, not a shield.
    expect(hasDefensePart(state, catalogByType)).toBe(false);
  });

  it('accepts danger 5 and refuses danger 6 while unarmed', () => {
    const state = starterPlayer(snapshot, 'luna');
    expect(decideDanger(state, catalogByType, offerAt(5))).toEqual({
      accept: true,
      reason: 'unarmed-safe-5',
    });
    expect(decideDanger(state, catalogByType, offerAt(6))).toEqual({
      accept: false,
      reason: 'unarmed-danger-6',
    });
  });

  it('accepts the hardest route once a real shield is installed', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.ship.parts.push({ id: 'shield-1', partType: 'shield_basic', condition: 100 });
    expect(hasDefensePart(state, catalogByType)).toBe(true);
    expect(decideDanger(state, catalogByType, offerAt(9))).toEqual({
      accept: true,
      reason: 'armed',
    });
  });
});

describe('repositionOffer', () => {
  it('plans the hop on a full tank: a nearly dry ship still sees the way out', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.locationId = EXPENSIVE_PORT;
    state.ship.fuel = 5;
    // On its current tank the ship reaches nowhere but where it stands — the trip only becomes
    // visible when planned against a full tank, which is what the hop branch buys.
    expect(reachablePorts(state, snapshot, rules, catalogByType)).toEqual([EXPENSIVE_PORT]);
    const offer = repositionOffer(
      state,
      snapshot,
      rules,
      catalogByType,
      buildFillerWorld(snapshot),
      1_000_000,
    );
    if (offer === null) throw new Error('expected a hop offer on a full tank');
    expect(offer.originId).toBe(EXPENSIVE_PORT);
    // Both other ports are cheaper than vesta (0.9 vs 1.0); either is a way out.
    expect([CHEAP_PORT, ALSO_CHEAP_PORT]).toContain(offer.destinationId);
  });
});
