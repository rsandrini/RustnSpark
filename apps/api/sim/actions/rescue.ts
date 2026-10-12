/**
 * Rescue, priced and applied exactly like `economy/rescue.service.ts → tow`: the ship is towed to
 * the nearest base for `rescuePrices(distance, rules)`, the wallet is debited **allowing a
 * negative balance** (rescue is the one debit that may go underwater), and the tank is topped up
 * to the emergency ration (`rescue_fuel_fraction` of the cap, never below what's already held).
 * A rescue is a poor fuel source — enough for one short job, not a way out of being broke.
 *
 * A rescue never sells or installs parts. That is the pilot's call, and the pilot keeps the ship
 * whole: a tow that stripped the cargo or the hull would leave the pilot alive but unemployable,
 * which is not a rescue — a pilot with empty hands scavenges for parts, sells the surplus, and
 * continues the journey. Rescue is charged in two places: an adrift hull (fuel ran out mid-route)
 * pays it as soon as the tow lands, and a pilot with no takeable offer pays it once they can buy
 * their way no further. The sim keeps an adrift hull at its origin port rather than at a floating
 * coordinate, so the tow distance is 0 and the `now` and `wait` prices collapse to the same flat
 * `rescue_cost × rescue_wait_fraction` fee — a simplification that can only undercharge, never
 * forgive, the fee.
 */
import type { GameRules } from '../../src/config/game-config.types.js';
import { rescuePrices } from '../../src/ships/floating.js';
import { fuelCapOf } from '../core/fleet.js';
import { type PlayerState } from '../core/state.js';
import type { CatalogRow, Snapshot } from '../snapshot/types.js';

/** A tow charges this even at zero distance — the flat `wait` half of `rescuePrices`. */
const ZERO_DISTANCE = 0;

export interface RescueResult {
  readonly cost: number;
  /** Fuel the ration actually added (the tank may already have been above it). */
  readonly rationAdded: number;
  readonly fuelAfter: number;
  readonly fuelCap: number;
  /** True when the rescue left the wallet underwater — the state a broke pilot recovers from. */
  readonly underwater: boolean;
}

/** What a rescue would cost and take, right now, without touching the wallet or the ship. */
export function rescueQuote(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
): { cost: number; ration: number; fuelCap: number } {
  const fuelCap = fuelCapOf(state, catalogByType, rules);
  const ration = Math.round(fuelCap * rules.economy.rescue_fuel_fraction);
  const { now } = rescuePrices(ZERO_DISTANCE, rules);
  return { cost: now, ration, fuelCap };
}

/**
 * Tow the ship to the nearest base, charge the rescue fee (wallet may go negative) and restore
 * the emergency ration. The ship keeps every installed part — a tow gets a stranded pilot to
 * safety, it does not decide what they fly next.
 */
export function rescue(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
): RescueResult {
  const { cost, ration, fuelCap } = rescueQuote(state, snapshot, rules, catalogByType);

  // The one debit that may drive the balance negative — rescue is not gated by a spending guard.
  state.wallet -= cost;
  state.ledger.record('rescue', -cost);

  // Emergency ration: never lowers fuel, never passes the tank. A rescue is a poor fuel source,
  // but a broke pilot can still fly one short job out of it.
  const rationAdded = Math.max(0, Math.min(fuelCap, ration) - state.ship.fuel);
  state.ship.fuel = Math.min(fuelCap, Math.max(state.ship.fuel, ration));

  return {
    cost,
    rationAdded,
    fuelAfter: state.ship.fuel,
    fuelCap,
    underwater: state.wallet < 0,
  };
}
