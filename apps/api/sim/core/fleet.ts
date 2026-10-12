/**
 * Shared ship facts the fuel and repair policies need: the fuel cap, the parts worth keeping
 * alive, and the port-to-port price comparison. Everything here reads the same pure calculators
 * the live services use — `refuelCost`, `locationFactor`, `repairSecondsPerPoint` — so a quote in
 * the sim is the quote the game would print.
 */
import type { GameRules } from '../../src/config/game-config.types.js';
import { fuelUnits, refuelCost } from '../../src/economy/fuel-cost.calculator.js';
import { locationFactor } from '../../src/economy/repair-cost.calculator.js';
import { repairSecondsPerPoint } from '../../src/economy/repair.service.js';
import { buildAdjacency } from '../../src/missions/generator/template.filler.js';
import { isDead } from '../../src/parts/condition.js';
import { deriveSheet } from '../../src/ships/sheet.deriver.js';
import type { CatalogRow, Snapshot } from '../snapshot/types.js';
import { installedParts, type PlayerState } from './state.js';
import { portFactsOf } from './world.js';

/** Full condition, the same `FULL_CONDITION` the resolver's pools use. */
export const FULL_CONDITION = 100;

/** The ship's fuel capacity: the sum of the live tanks' `fuelCap`. */
export function fuelCapOf(
  state: PlayerState,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  rules: GameRules,
): number {
  return deriveSheet(installedParts(state.ship, catalogByType), rules).fuelCap;
}

/** Condition points the ship has lost across its installed parts. */
export function wearPointsOf(state: PlayerState): number {
  return state.ship.parts.reduce(
    (sum, part) => sum + Math.max(0, FULL_CONDITION - part.condition),
    0,
  );
}

/** Average condition of the installed parts (0 when the ship is somehow empty). */
export function averageConditionOf(state: PlayerState): number {
  if (state.ship.parts.length === 0) return 0;
  const sum = state.ship.parts.reduce((total, part) => total + part.condition, 0);
  return sum / state.ship.parts.length;
}

/** The worst condition among the installed parts (0 when the ship is somehow empty). */
export function minConditionOf(state: PlayerState): number {
  if (state.ship.parts.length === 0) return 0;
  return Math.min(...state.ship.parts.map((part) => part.condition));
}

/**
 * Parts the ship cannot fly without: engines (thrust), tanks (range) and defense (hull/shield,
 * the one `DEFENSE` class the catalog uses). These are the "key parts" the plan's repair rule
 * protects.
 */
export function isKeyPart(catalog: CatalogRow): boolean {
  return (
    catalog.partClass === 'ENGINE' ||
    catalog.partClass === 'TANK' ||
    catalog.partClass === 'DEFENSE'
  );
}

/** The worst condition among the key parts the ship is flying with (100 when it has none). */
export function minKeyConditionOf(
  state: PlayerState,
  catalogByType: ReadonlyMap<string, CatalogRow>,
): number {
  let worst = FULL_CONDITION;
  for (const part of state.ship.parts) {
    const catalog = catalogByType.get(part.partType);
    if (catalog === undefined || !isKeyPart(catalog)) continue;
    worst = Math.min(worst, part.condition);
  }
  return worst;
}

/**
 * The raw (unrounded) batch price of `units` at a port. `refuel.service.ts → start` rounds the
 * whole batch once (`Math.max(1, Math.round(raw))`); the policy compares ports on this figure so
 * a cheaper port is never hidden by per-unit rounding.
 */
export function refuelCostRaw(
  units: number,
  isolation: number,
  factionRelation: string,
  rules: GameRules,
): number {
  return refuelCost(units, isolation, factionRelation, rules);
}

/** What the wallet is charged for `units` at a port: the live service's rounding, once. */
export function refuelCostCharged(
  units: number,
  isolation: number,
  factionRelation: string,
  rules: GameRules,
): number {
  if (units <= 0) return 0;
  return Math.max(1, Math.round(refuelCost(units, isolation, factionRelation, rules)));
}

/** The location factor of a port: isolation × faction, the `fator_local` of GDD §9. */
export function portFactor(
  snapshot: Snapshot,
  rules: GameRules,
  locationId: string,
  playerFactionId: string,
): number {
  const facts = portFactsOf(snapshot, locationId, playerFactionId);
  return locationFactor(facts.isolation, facts.factionRelation, rules);
}

/** Repair duration per condition point at a port (hub ≤ zone 1, outpost ≥ zone 2). */
export function repairSecondsAt(
  snapshot: Snapshot,
  rules: GameRules,
  locationId: string,
): number {
  const row = snapshot.locations.find((location) => location.id === locationId);
  if (row === undefined) throw new Error(`location ${locationId} is not in the snapshot`);
  return repairSecondsPerPoint(rules, row.zone);
}

/** A part still worth flying: not dead by the resolver's own `isDead` rule. */
export function isLivePart(part: { condition: number }, rules: GameRules): boolean {
  return !isDead(part.condition, rules);
}

/**
 * Every port the ship can reach from `originFuel` (default: the current tank; no refuel on the
 * way): a flood fill over the route graph, capped by the fuel left after each hop. The policy
 * uses this to decide whether a cheaper port is "in reach" before it books a TRAVEL trip, and
 * plans a hop on a *full* tank so a near-dry ship still knows where a refuel could take it.
 */
export function reachablePorts(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  originFuel: number = state.ship.fuel,
): string[] {
  const fuelUse = deriveSheet(installedParts(state.ship, catalogByType), rules).fuelUse;
  const adjacency = buildAdjacency(
    snapshot.routes.map((row) => ({
      id: row.id,
      nodeAId: row.nodeAId,
      nodeBId: row.nodeBId,
      distance: row.distance,
      danger: row.danger,
    })),
  );
  const envMultByRoute = new Map<string, number>();
  for (const entry of snapshot.routeEnvironments) {
    const env = snapshot.environments.find((candidate) => candidate.id === entry.environmentId);
    envMultByRoute.set(entry.routeId, env?.fuelMult ?? 1);
  }
  const reached = new Map<string, number>([[state.locationId, originFuel]]);
  const queue: string[] = [state.locationId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const fuelHere = reached.get(current) ?? 0;
    for (const edge of adjacency.get(current) ?? []) {
      const mult = envMultByRoute.get(edge.route.id) ?? 1;
      const cost = fuelUnits({ fuelUse, distance: edge.route.distance, envFuelMult: mult });
      const fuelThere = fuelHere - cost;
      const known = reached.get(edge.neighborId);
      if (fuelThere >= 0 && (known === undefined || fuelThere > known)) {
        reached.set(edge.neighborId, fuelThere);
        queue.push(edge.neighborId);
      }
    }
  }
  return [...reached.keys()];
}
