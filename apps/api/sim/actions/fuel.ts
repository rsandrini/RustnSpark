/**
 * Refuelling, priced exactly like `economy/refuel.service.ts → start`: units are capped by the
 * tank, the batch is priced once with `refuelCost` and rounded once, and a positive purchase never
 * rounds to free. The wallet is debited through the ledger so the run's cash flow stays honest.
 */
import type { GameRules } from '../../src/config/game-config.types.js';
import { deriveSheet } from '../../src/ships/sheet.deriver.js';
import type { CatalogRow, Snapshot } from '../snapshot/types.js';
import { fuelCapOf, refuelCostCharged, refuelCostRaw } from '../core/fleet.js';
import { installedParts, type PlayerState } from '../core/state.js';
import { portFactsOf } from '../core/world.js';

export interface RefuelResult {
  readonly units: number;
  readonly cost: number;
  readonly fuelAfter: number;
  readonly fuelCap: number;
}

/** What a full (or partial) refuel would cost here, without touching the wallet or the tank. */
export function refuelQuote(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  locationId: string,
  units?: number,
): { units: number; cost: number; fuelCap: number } {
  const facts = portFactsOf(snapshot, locationId, state.factionId);
  const fuelCap = fuelCapOf(state, catalogByType, rules);
  const gap = Math.max(0, fuelCap - state.ship.fuel);
  const wanted = units === undefined ? gap : Math.max(0, units);
  const capped = Math.min(wanted, gap);
  return {
    units: capped,
    cost: refuelCostCharged(capped, facts.isolation, facts.factionRelation, rules),
    fuelCap,
  };
}

/**
 * Buy `units` of fuel (default: fill the tank) at `locationId`. The ship must be in port — the
 * same rule as the live service, which refuses to refuel a ship that is `ON_MISSION`.
 */
export function refuel(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  locationId: string,
  units?: number,
): RefuelResult {
  if (state.locationId !== locationId) {
    throw new Error(`cannot refuel at ${locationId}: ship is at ${state.locationId}`);
  }
  const quote = refuelQuote(state, snapshot, rules, catalogByType, locationId, units);
  if (quote.units <= 0) {
    return { units: 0, cost: 0, fuelAfter: state.ship.fuel, fuelCap: quote.fuelCap };
  }
  if (quote.cost > state.wallet) {
    throw new Error(
      `cannot refuel ${quote.units} units at ${locationId}: costs ${quote.cost}, wallet ${state.wallet}`,
    );
  }
  state.wallet -= quote.cost;
  state.ledger.record('fuel', -quote.cost);
  state.ship.fuel = Math.min(quote.fuelCap, state.ship.fuel + quote.units);
  return {
    units: quote.units,
    cost: quote.cost,
    fuelAfter: state.ship.fuel,
    fuelCap: quote.fuelCap,
  };
}

/**
 * The raw (unrounded) price of a batch at a port — the figure the cheap-port policy compares.
 * Re-exported so the policy never has to reach into the calculator for the rounding-free number.
 */
export function fuelRawPrice(
  snapshot: Snapshot,
  rules: GameRules,
  locationId: string,
  playerFactionId: string,
  units: number,
): number {
  const facts = portFactsOf(snapshot, locationId, playerFactionId);
  return refuelCostRaw(units, facts.isolation, facts.factionRelation, rules);
}

/** The installed sheet's `fuelUse` — what one unit of distance costs this ship. */
export function fuelUseOf(
  state: PlayerState,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  rules: GameRules,
): number {
  return deriveSheet(installedParts(state.ship, catalogByType), rules).fuelUse;
}
