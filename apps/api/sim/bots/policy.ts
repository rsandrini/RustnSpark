/**
 * Where to buy fuel and when to repair — the two decisions that turn "net profit per mission"
 * from a fake number into a real one. A port is *cheap* when its location factor is within 10% of
 * the cheapest port the ship can reach on its current tank; otherwise it is *expensive*.
 */
import type { GameRules } from '../../src/config/game-config.types.js';
import { fuelUnits } from '../../src/economy/fuel-cost.calculator.js';
import type { FillerWorld } from '../../src/missions/generator/template.filler.js';
import { deriveSheet } from '../../src/ships/sheet.deriver.js';
import { canTakeMission } from '../actions/mission.js';
import { travelOffer } from '../actions/travel.js';
import {
  averageConditionOf,
  fuelCapOf,
  minConditionOf,
  minKeyConditionOf,
  portFactor,
  reachablePorts,
} from '../core/fleet.js';
import { installedParts, type PlayerState } from '../core/state.js';
import type { Offer } from '../core/world.js';
import type { CatalogRow, Snapshot } from '../snapshot/types.js';

/** Tolerance for "cheap enough": within 10% of the cheapest reachable port. */
export const CHEAP_PORT_TOLERANCE = 0.1;
/** Repair when the average condition drops below this. */
export const REPAIR_AVG_THRESHOLD = 70;
/** Repair when any key part (engine, tank, hull, shield) drops below this. */
export const REPAIR_KEY_THRESHOLD = 40;

/**
 * The peak leg danger a defense-less ship will accept. The starter kit has no weapon and no
 * shield, so a hard (danger-9) route is a coin-flip against a pirate it cannot hurt and cannot
 * soak — near-certain death, and the fight costs more in combat losses than the job ever pays.
 * Until a DEFENSE-class part is installed, the bot only flies easy/medium (low-danger) work.
 */
export const SAFE_MAX_DANGER_UNARMED = 5;

/** Peak danger across an offer's legs (same figure `MissionRunResult.maxDanger` reports). */
export function offerMaxDanger(offer: Offer): number {
  return offer.legs.reduce((peak, leg) => Math.max(peak, leg.danger), 0);
}

/**
 * Does the ship carry a real shield/armor layer? The catalog classes both shields and bare hull
 * blocks as `DEFENSE`, but only a part with a positive shield rating (`esc`) actually sits in
 * front of the hull — `resolution/power/power.ts` and `wear/failure.resolver.ts` both gate on
 * `esc > 0` before calling a part a shield. A starter hull is structure, not protection, so a
 * ship with only a hull is unarmed.
 */
export function hasDefensePart(
  state: PlayerState,
  catalogByType: ReadonlyMap<string, CatalogRow>,
): boolean {
  return state.ship.parts.some((part) => {
    const row = catalogByType.get(part.partType);
    return row?.partClass === 'DEFENSE' && (row.esc ?? 0) > 0;
  });
}

export interface DangerDecision {
  readonly accept: boolean;
  readonly reason: string;
}

/**
 * Should the bot fly this offer at all, danger-wise? A ship with no defense refuses anything
 * above `SAFE_MAX_DANGER_UNARMED` — hard missions without a shield are a trap, not a payday.
 */
export function decideDanger(
  state: PlayerState,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  offer: Offer,
): DangerDecision {
  if (hasDefensePart(state, catalogByType)) return { accept: true, reason: 'armed' };
  const peak = offerMaxDanger(offer);
  if (peak > SAFE_MAX_DANGER_UNARMED) {
    return { accept: false, reason: `unarmed-danger-${peak}` };
  }
  return { accept: true, reason: `unarmed-safe-${peak}` };
}

/** How many units a mission's legs will burn, at this ship's current `fuelUse`. */
export function missionFuelNeed(state: PlayerState, offer: Offer, ctx: { rules: GameRules; catalogByType: ReadonlyMap<string, CatalogRow> }): number {
  const fuelUse = deriveSheet(installedParts(state.ship, ctx.catalogByType), ctx.rules).fuelUse;
  return offer.legs.reduce(
    (sum, leg) => sum + fuelUnits({ fuelUse, distance: leg.distance, envFuelMult: leg.env.fuelMult }),
    0,
  );
}

/** Does the ship need a repair right now, by the plan's own thresholds? */
export function needsRepair(
  state: PlayerState,
  catalogByType: ReadonlyMap<string, CatalogRow>,
): boolean {
  return (
    averageConditionOf(state) < REPAIR_AVG_THRESHOLD ||
    minKeyConditionOf(state, catalogByType) < REPAIR_KEY_THRESHOLD
  );
}

/** Is the ship too worn to fly safely (a key part near dead)? */
export function isShipGrounded(
  state: PlayerState,
  catalogByType: ReadonlyMap<string, CatalogRow>,
): boolean {
  return minConditionOf(state) <= 0 || minKeyConditionOf(state, catalogByType) <= 5;
}

export interface CheapPortChoice {
  readonly locationId: string;
  readonly factor: number;
  readonly isCheap: boolean;
}

/**
 * Classify the port the ship is at and the cheaper ports it can reach. The cheapest reachable port
 * is the baseline; a port is cheap when its factor is within `CHEAP_PORT_TOLERANCE` of it.
 */
export function cheapPortsOf(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
): { current: CheapPortChoice; cheapest: CheapPortChoice; reachable: CheapPortChoice[] } {
  const reachable = reachablePorts(state, snapshot, rules, catalogByType);
  const withFactors = reachable.map((locationId) => ({
    locationId,
    factor: portFactor(snapshot, rules, locationId, state.factionId),
    isCheap: false,
  }));
  const cheapestFactor = withFactors.reduce(
    (min, port) => Math.min(min, port.factor),
    Number.POSITIVE_INFINITY,
  );
  const classified = withFactors.map((port) => ({
    ...port,
    isCheap: port.factor <= cheapestFactor * (1 + CHEAP_PORT_TOLERANCE),
  }));
  const current =
    classified.find((port) => port.locationId === state.locationId) ?? {
      locationId: state.locationId,
      factor: portFactor(snapshot, rules, state.locationId, state.factionId),
      isCheap: false,
    };
  const cheapest = classified.reduce(
    (best, port) => (port.factor < best.factor ? port : best),
    current,
  );
  return { current, cheapest, reachable: classified };
}

/** Should the bot refuel here, and how much? The plan's exact rule. */
export interface FuelDecision {
  readonly shouldRefuel: boolean;
  /** Undefined = fill the tank. */
  readonly units?: number;
  readonly reason: string;
}

export function decideFuel(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  nextOffer: Offer | null,
): FuelDecision {
  const fuelCap = deriveSheet(installedParts(state.ship, catalogByType), rules).fuelCap;
  const gap = fuelCap - state.ship.fuel;
  if (gap <= 0) return { shouldRefuel: false, reason: 'tank-full' };

  const { current } = cheapPortsOf(state, snapshot, rules, catalogByType);

  // At an expensive port, buy only what the next chosen mission needs — and only if the ship
  // cannot fly it otherwise.
  if (!current.isCheap) {
    if (nextOffer === null) return { shouldRefuel: false, reason: 'no-next-mission' };
    const needed = missionFuelNeed(state, nextOffer, { rules, catalogByType });
    const shortfall = needed - state.ship.fuel;
    if (shortfall <= 0) return { shouldRefuel: false, reason: 'enough-for-next' };
    return { shouldRefuel: true, units: shortfall, reason: 'expensive-port-minimum' };
  }

  // At a cheap stop, fill the tank — the plan's rule.
  return { shouldRefuel: true, reason: 'cheap-port-fill' };
}

/**
 * The hop that gets a pilot with no work in hand closer to some. The target is the cheapest port
 * a *full* tank can reach — planning on the current tank would strand a near-dry ship at a port
 * where the board rejects every offer on fuel. The hop branch prices and buys that refuel, so
 * the plan is only as expensive as the trip itself. When the pilot is already at the cheapest
 * port a full tank reaches, any neighbour will do: the point is to move, because the board here
 * offers nothing.
 */
export function repositionOffer(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  world: FillerWorld,
  nowMs: number,
): Offer | null {
  const fullTank = fuelCapOf(state, catalogByType, rules);
  const reachable = reachablePorts(state, snapshot, rules, catalogByType, fullTank)
    .filter((locationId) => locationId !== state.locationId);
  if (reachable.length === 0) return null;
  const target = reachable
    .map((locationId) => ({
      locationId,
      factor: portFactor(snapshot, rules, locationId, state.factionId),
    }))
    .sort((a, b) => a.factor - b.factor)[0]?.locationId;
  if (target === undefined) return null;
  return travelOffer({ snapshot, world, state, destinationId: target, nowMs });
}

export interface RepairDecision {
  readonly shouldRepair: boolean;
  readonly reason: string;
}

export function decideRepair(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
): RepairDecision {
  const { current, cheapest } = cheapPortsOf(state, snapshot, rules, catalogByType);
  const needs = needsRepair(state, catalogByType);
  const grounded = isShipGrounded(state, catalogByType);

  // At a cheap port, repair when the thresholds say so.
  if (current.isCheap && needs) {
    return { shouldRepair: true, reason: 'cheap-port-threshold' };
  }
  // At an expensive port, repair only when the ship cannot fly otherwise.
  if (!current.isCheap && grounded) {
    return { shouldRepair: true, reason: 'expensive-port-forced' };
  }
  // The ship needs a repair but is at an expensive port and not grounded: go to the cheapest
  // reachable port if that is cheaper (the caller books the trip).
  if (needs && !current.isCheap && cheapest.locationId !== current.locationId) {
    return { shouldRepair: false, reason: 'travel-to-cheap-repair' };
  }
  return { shouldRepair: false, reason: 'healthy' };
}

/** The next mission's fuel shortfall, if any — the number the expensive-port rule buys. */
export function fuelShortfallFor(
  state: PlayerState,
  offer: Offer,
  ctx: { rules: GameRules; catalogByType: ReadonlyMap<string, CatalogRow> },
): number {
  return Math.max(0, missionFuelNeed(state, offer, ctx) - state.ship.fuel);
}

/** Can the ship reach `destinationId` on its current tank? */
export function canReach(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  destinationId: string,
): boolean {
  return reachablePorts(state, snapshot, rules, catalogByType).includes(destinationId);
}

/**
 * The cheapest port the ship can reach (by location factor), or null when it is already at the
 * cheapest. The bot uses this to decide whether a repositioning trip is worth booking.
 */
export function cheapestReachablePort(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
): string | null {
  const { current, cheapest } = cheapPortsOf(state, snapshot, rules, catalogByType);
  if (cheapest.locationId === current.locationId) return null;
  if (cheapest.factor >= current.factor) return null;
  return cheapest.locationId;
}

/** Would a repositioning trip to `destinationId` actually get the ship there? */
export function canTravelTo(
  state: PlayerState,
  ctx: { snapshot: Snapshot; rules: GameRules; catalogByType: ReadonlyMap<string, CatalogRow> },
  world: FillerWorld,
  destinationId: string,
  nowMs: number,
): boolean {
  const offer = travelOffer({ snapshot: ctx.snapshot, world, state, destinationId, nowMs });
  if (offer === null) return false;
  return canTakeMission(state, offer, ctx).ok;
}
