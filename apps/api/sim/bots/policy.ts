/**
 * Where to buy fuel, when to repair, and what to buy, sell and upgrade between missions — the
 * decisions that turn "net profit per mission" from a fake number into a real one. A port is
 * *cheap* when its location factor is within 10% of the cheapest port the ship can reach on its
 * current tank; otherwise it is *expensive*. The spending plan is the plan's own rule: reserve a
 * full refuel plus the expected repair bill, find the lowest-rarity slot of the target ship, and
 * take the cheapest net way to raise it the wallet allows.
 */
import type { GameRules } from '../../src/config/game-config.types.js';
import { fuelUnits } from '../../src/economy/fuel-cost.calculator.js';
import { sellPrice } from '../../src/economy/price.calculator.js';
import { basePartTypeOf, nextTierPartTypeOf } from '../../src/economy/part-upgrade.calculator.js';
import { upgradeNeeds, type MaterialNeed } from '../../src/economy/upgrade-materials.js';
import type { FillerWorld } from '../../src/missions/generator/template.filler.js';
import { deriveSheet } from '../../src/ships/sheet.deriver.js';
import { checkViability } from '../../src/ships/viability.js';
import { canTakeMission } from '../actions/mission.js';
import { travelOffer } from '../actions/travel.js';
import { refuelQuote } from '../actions/fuel.js';
import { fitWouldBeViable, marketShelf, priceInputAt } from '../actions/market.js';
import { priorityBasesOf, usesChemEngine, type Archetype } from './archetype.js';
import { retentionFor, upgradeQuote } from '../actions/upgrade.js';
import {
  averageConditionOf,
  FULL_CONDITION,
  fuelCapOf,
  minConditionOf,
  minKeyConditionOf,
  portFactor,
  reachablePorts,
} from '../core/fleet.js';
import {
  installedParts,
  RARITY_ORDER,
  shipLevel,
  type PlayerState,
  type ShipPartState,
} from '../core/state.js';
import type { Offer } from '../core/world.js';
import type { CatalogRow, Snapshot } from '../snapshot/types.js';
import { repairQuote } from '../actions/repair.js';

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

/**
 * How much fuel the pilot wants aboard for a mission: what its legs burn at this ship's
 * `fuelUse`, times the tank pump's worst case (`power.pump_fuel_factor`). A leg whose pump roll
 * fails burns that much more, and a ship that left with exactly the burn ran dry and was towed:
 * the game lets you leave on the bare figure, a careful pilot does not.
 */
export function missionFuelNeed(state: PlayerState, offer: Offer, ctx: { rules: GameRules; catalogByType: ReadonlyMap<string, CatalogRow> }): number {
  const fuelUse = deriveSheet(installedParts(state.ship, ctx.catalogByType), ctx.rules).fuelUse;
  const burn = offer.legs.reduce(
    (sum, leg) => sum + fuelUnits({ fuelUse, distance: leg.distance, envFuelMult: leg.env.fuelMult }),
    0,
  );
  return Math.ceil(burn * Math.max(1, ctx.rules.power.pump_fuel_factor));
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

/**
 * Is the ship too worn to fly? The condition rules (a part worn out, a key part near dead) and
 * the board's own gate: the resolver derives the sheet from living parts only, so a dead tank is
 * no tank — fuel capacity and with it `checkViability`'s fuel rule are gone while the part still
 * sits at condition 1, above the old `<= 0` line. Grounded now means what the mission board
 * means by it, or the repair policy never fires for the one failure that grounds a ship.
 */
export function isShipGrounded(
  state: PlayerState,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
): boolean {
  if (minConditionOf(state) <= 0 || minKeyConditionOf(state, catalogByType) <= 5) return true;
  const installed = installedParts(state.ship, catalogByType);
  return !checkViability(deriveSheet(installed, rules), installed, rules).viable;
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
  const grounded = isShipGrounded(state, rules, catalogByType);

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

// ---------------------------------------------------------------------------
// Phase 3: scavenging, mining, selling and spending between missions.
// ---------------------------------------------------------------------------

/** Scavenge on at least this share of missions when the cooldown allows (plan task 4). */
export const SCAVENGE_RATIO_MIN = 0.75;
/** Mine on at least this share of missions where the ship can (rig + minable place). */
export const MINE_RATIO_MIN = 0.5;
/** The trailing window both ratios are measured over. */
export const RATIO_WINDOW = 20;
/** Repair bills this run has paid; until the first one, the reserve uses the fallback. */
export const REPAIR_BILL_FALLBACK_CREDITS = 500;
/** How many recent repair bills average into the reserve. */
export const REPAIR_SAMPLE = 5;
/** Playtime cap: 400 hours of game time (the spec's exhaustion end). */
export const PLAYTIME_CAP_SECONDS = 400 * 3600;
/** The spec's top ship level (LEGENDARY everywhere). */
export const MAX_SHIP_LEVEL = 5;
/** No level change and no wallet growth across this many missions → the run is stalled. */
export const PROGRESS_STALL_MISSIONS = 200;

/**
 * The 12-part target ship (spec §the build): the starter kit grown to the full hull. Slots the
 * starter does not have yet are bought at the current ship level, so filling them never lowers
 * the level, and extra parts (a second tank, a scavenged rig) are allowed alongside.
 */
export const TARGET_KIT_BASES: readonly string[] = [
  'bridge',
  'engine_chem_medium',
  'engine_chem_small',
  'tank_medium',
  'battery_large',
  'cargo_large',
  'cargo',
  'hull',
  'weapon_laser',
  'shield_basic',
  'sensor_radar',
  'reactor_solar',
];

/** The kit the archetype grows: ion drops the chemical engines and tank for the ion drive. */
export function kitBasesOf(archetype: Archetype): readonly string[] {
  const base = usesChemEngine(archetype)
    ? TARGET_KIT_BASES
    : TARGET_KIT_BASES.filter((b) => !/^(engine_chem|tank)/.test(b));
  const extra = priorityBasesOf(archetype).filter((b) => !base.includes(b));
  return [...base, ...extra];
}

const RARITY_SUFFIX: Readonly<Record<string, string>> = {
  COMMON: '',
  UNCOMMON: '_uncommon',
  RARE: '_rare',
  EPIC: '_epic',
  LEGENDARY: '_legendary',
};

function rarityIndex(rarity: string): number {
  const index = RARITY_ORDER.indexOf(rarity as (typeof RARITY_ORDER)[number]);
  return index === -1 ? 0 : index;
}

/**
 * Does this behaviour still need to run? True while the window's share is at or under its
 * target (an empty window starts the behaviour: there is no evidence against it). Firing at
 * equality rather than strictly below is what holds the *long-run* share up: with a 20-entry
 * window a strict `<` dips to 14/20 on every correction and converges near 71%, while `<=`
 * sustains ~76% — the plan asks for at least 75% over a long run.
 */
export function atOrBelowTarget(history: readonly boolean[], min: number): boolean {
  if (history.length === 0) return true;
  let yes = 0;
  for (const flag of history) if (flag) yes += 1;
  return yes / history.length <= min;
}

/** The family name a part belongs to (`hull_rare` → `hull`), straight off the naming convention. */
function familyBaseOf(row: CatalogRow): string {
  return basePartTypeOf(row.partType, row.rarity);
}

export type SpendAction =
  | { readonly kind: 'none'; readonly reason: string }
  | {
      readonly kind: 'fit';
      readonly storageId: string;
      readonly replaceId: string | null;
      readonly targetBase: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'buy';
      readonly listingId: string;
      readonly partType: string;
      readonly locationId: string;
      readonly price: number;
      readonly replaceId: string | null;
      readonly targetBase: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'travel-to-buy';
      readonly locationId: string;
      readonly targetBase: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'upgrade';
      readonly partId: string;
      readonly nextPartType: string;
      readonly reason: string;
    };

export interface SpendPlan {
  readonly action: SpendAction;
  /** What the target slot's in-place upgrade asks for — the surplus pass sells around it. */
  readonly keepNeeds: readonly MaterialNeed[];
}

interface SpendTarget {
  /** Slot rarity, 0-based: an installed part's tier, or the current level for a missing slot. */
  readonly rarityIdx: number;
  readonly base: string;
  /** The installed part to raise, or null for a missing kit slot (a fill). */
  readonly replaceId: string | null;
  readonly nextRow: CatalogRow;
  readonly currentRow: CatalogRow | null;
  readonly currentCondition: number | null;
}

interface SpendOption {
  readonly net: number;
  readonly cash: number;
  readonly action: Exclude<SpendAction, { readonly kind: 'none' }>;
}

/** What filling or raising this slot's upgrade would ask for in materials (no wallet in it). */
function keepNeedsOf(target: SpendTarget, rules: GameRules): readonly MaterialNeed[] {
  if (target.currentRow === null || target.replaceId === null) return [];
  return upgradeNeeds(
    target.currentRow.rarity,
    target.nextRow.basePrice - target.currentRow.basePrice,
    target.currentRow.w * target.currentRow.h,
    rules,
  );
}

/**
 * Among the ports a full tank can reach, the cheapest listing of `partType` on today's shelf —
 * new or used, real stock only: a rarity the bridge's chance kept off the shelf cannot be bought
 * at any price, and the day's sold set already rules out what has been taken. Ties prefer here.
 */
function bestBuyPort(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  partType: string,
): { locationId: string; listingId: string; price: number; condition: number } | null {
  const row = catalogByType.get(partType);
  if (row === undefined || !row.active) return null;
  const fullTank = fuelCapOf(state, catalogByType, rules);
  const reachable = reachablePorts(state, snapshot, rules, catalogByType, fullTank);
  const ordered = [state.locationId, ...reachable.filter((id) => id !== state.locationId).sort()];
  let best: { locationId: string; listingId: string; price: number; condition: number } | null =
    null;
  for (const locationId of ordered) {
    for (const listing of marketShelf(state, snapshot, rules, catalogByType, locationId)) {
      if (listing.partType !== partType) continue;
      if (best === null || listing.price < best.price) {
        best = { locationId, listingId: listing.listingId, price: listing.price, condition: listing.condition };
      }
    }
  }
  return best;
}

function optionsFor(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  target: SpendTarget,
): SpendOption[] {
  const options: SpendOption[] = [];
  // (a) Fit a loose part of the family at the *target* tier or better — free, if one is held.
  // Only progress counts: an equal-rarity swap is worth nothing to the ship's level, and a net-0
  // option outranking every buy would have the pilot ping-ponging parts forever.
  let bestLoose: ShipPartState | null = null;
  let bestLooseIdx = -1;
  const neededIdx = rarityIndex(target.nextRow.rarity);
  for (const candidate of state.storage) {
    const row = catalogByType.get(candidate.partType);
    if (row === undefined || !row.active) continue;
    if (familyBaseOf(row) !== target.base) continue;
    const idx = rarityIndex(row.rarity);
    if (idx < neededIdx) continue;
    if (idx > bestLooseIdx) {
      bestLoose = candidate;
      bestLooseIdx = idx;
    }
  }
  if (
    bestLoose !== null &&
    fitWouldBeViable(
      state,
      rules,
      catalogByType,
      bestLoose,
      target.replaceId ?? undefined,
    )
  ) {
    options.push({
      net: 0,
      cash: 0,
      action: {
        kind: 'fit',
        storageId: bestLoose.id,
        replaceId: target.replaceId,
        targetBase: target.base,
        reason: 'fit-loose',
      },
    });
  }
  // (b) Buy the tier at the cheapest reachable port, net of what the old part sells for — only
  // when the bought part would actually fly in this slot (same power/viability gate as a fit:
  // a part that cannot be fitted is money the reserve just lit on fire).
  const buy = bestBuyPort(state, snapshot, rules, catalogByType, target.nextRow.partType);
  if (
    buy !== null &&
    fitWouldBeViable(
      state,
      rules,
      catalogByType,
      { id: 'phantom-buy', partType: target.nextRow.partType, condition: FULL_CONDITION },
      target.replaceId ?? undefined,
    )
  ) {
    const oldSell =
      target.currentRow !== null && target.currentCondition !== null
        ? sellPrice(
            priceInputAt(
              snapshot,
              state.factionId,
              buy.locationId,
              target.currentRow.basePrice,
              target.currentCondition,
            ),
            rules,
          )
        : 0;
    const net = buy.price - oldSell;
    if (buy.locationId === state.locationId) {
      options.push({
        net,
        cash: buy.price,
        action: {
          kind: 'buy',
          listingId: buy.listingId,
          partType: target.nextRow.partType,
          locationId: buy.locationId,
          price: buy.price,
          replaceId: target.replaceId,
          targetBase: target.base,
          reason: 'buy-next-tier',
        },
      });
    } else {
      options.push({
        net,
        cash: buy.price,
        action: {
          kind: 'travel-to-buy',
          locationId: buy.locationId,
          targetBase: target.base,
          reason: 'hop-to-buy',
        },
      });
    }
  }
  // (c) Upgrade in place: full condition, materials counted as free (missing = not an option
  // at all, per the plan), and the raised part must still fly — same gate as (a) and (b).
  // An engine swap target is a different family: raising the old engine in place is not it.
  const isSwap =
    target.currentRow !== null && familyBaseOf(target.currentRow) !== target.base;
  if (!isSwap && target.replaceId !== null && target.currentCondition === FULL_CONDITION) {
    const quote = upgradeQuote(state, snapshot, rules, catalogByType, target.replaceId);
    const nextPartType = quote.nextPartType ?? target.nextRow.partType;
    if (
      quote.ok &&
      quote.cost !== undefined &&
      fitWouldBeViable(
        state,
        rules,
        catalogByType,
        { id: target.replaceId, partType: nextPartType, condition: FULL_CONDITION },
        target.replaceId,
      )
    ) {
      options.push({
        net: quote.cost,
        cash: quote.cost,
        action: {
          kind: 'upgrade',
          partId: target.replaceId,
          nextPartType,
          reason: 'upgrade-in-place',
        },
      });
    }
  }
  return options;
}

/**
 * Where a target sits in the archetype's buy order. Only a fill or an engine swap counts: raising
 * a part the ship already has (a second-tier battery) is ordinary upgrade work, not the build.
 */
function priorityRankOf(order: readonly string[], target: SpendTarget): number {
  const at = order.indexOf(target.base);
  const isSwap =
    target.currentRow !== null && familyBaseOf(target.currentRow) !== target.base;
  if (at === -1 || (target.replaceId !== null && !isSwap)) return order.length;
  return at;
}

function spendTargetsOf(
  state: PlayerState,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  archetype: Archetype = 'chem',
): SpendTarget[] {
  const targets: SpendTarget[] = [];
  const ion = !usesChemEngine(archetype);
  const priority = priorityBasesOf(archetype);
  // Raise the installed parts to their next tier.
  for (const part of state.ship.parts) {
    const row = catalogByType.get(part.partType);
    if (row === undefined) continue;
    // The ion archetype never raises the chemical engine or tank it is about to drop.
    if (ion && /^(engine_chem|tank)/.test(familyBaseOf(row))) continue;
    const idx = rarityIndex(row.rarity);
    if (idx >= RARITY_ORDER.length - 1) continue;
    const nextType = nextTierPartTypeOf(part.partType, row.rarity);
    if (nextType === null) continue;
    const nextRow = catalogByType.get(nextType);
    if (nextRow === undefined || !nextRow.active) continue;
    // An upgrade is rarity and stats, never a different footprint.
    if (nextRow.w !== row.w || nextRow.h !== row.h) continue;
    targets.push({
      rarityIdx: idx,
      base: familyBaseOf(row),
      replaceId: part.id,
      nextRow,
      currentRow: row,
      currentCondition: part.condition,
    });
  }
  // Fill the kit slots the ship does not have yet, at its current level (never below it).
  const level = shipLevel(state.ship, catalogByType);
  const fillIdx = level - 1;
  const covered = new Set(
    state.ship.parts.map((part) => {
      const row = catalogByType.get(part.partType);
      return row === undefined ? part.partType : familyBaseOf(row);
    }),
  );
  const fillRarity = RARITY_ORDER[fillIdx];
  const fillSuffix = fillRarity === undefined ? null : RARITY_SUFFIX[fillRarity] ?? '';
  // The ion archetype swaps the chemical engine for the ion drive: a replace target, so the
  // viability gate sees the ship without the old engine.
  if (ion && fillSuffix !== null && !covered.has('engine_ion_micro')) {
    const chem = state.ship.parts.find((part) => {
      const row = catalogByType.get(part.partType);
      return row !== undefined && familyBaseOf(row).startsWith('engine_chem');
    });
    const ionRow = catalogByType.get(`engine_ion_micro${fillSuffix}`);
    const chemRow = chem === undefined ? undefined : catalogByType.get(chem.partType);
    if (chem !== undefined && chemRow !== undefined && ionRow !== undefined && ionRow.active) {
      targets.push({
        rarityIdx: fillIdx,
        base: 'engine_ion_micro',
        replaceId: chem.id,
        nextRow: ionRow,
        currentRow: chemRow,
        currentCondition: chem.condition,
      });
    }
  }
  // The ion drive and the shield both draw continuously: one panel is not enough, so the ion
  // archetype carries a second.
  if (ion && fillSuffix !== null) {
    const panels = state.ship.parts.filter((part) => {
      const row = catalogByType.get(part.partType);
      return row !== undefined && familyBaseOf(row) === 'reactor_solar';
    }).length;
    const panelRow = catalogByType.get(`reactor_solar${fillSuffix}`);
    if (panels < 2 && panelRow !== undefined && panelRow.active) {
      targets.push({
        rarityIdx: fillIdx,
        base: 'reactor_solar',
        replaceId: null,
        nextRow: panelRow,
        currentRow: null,
        currentCondition: null,
      });
    }
  }
  for (const base of kitBasesOf(archetype)) {
    if (fillSuffix === null) break;
    if (covered.has(base)) continue;
    const wantedType = `${base}${fillSuffix}`;
    const wantedRow = catalogByType.get(wantedType);
    if (wantedRow === undefined || !wantedRow.active) continue;
    targets.push({
      rarityIdx: fillIdx,
      base,
      replaceId: null,
      nextRow: wantedRow,
      currentRow: null,
      currentCondition: null,
    });
  }
  if (priority.length > 0) {
    targets.sort(
      (left, right) => priorityRankOf(priority, left) - priorityRankOf(priority, right),
    );
  }
  return targets;
}

/**
 * The plan's spending rule (task 4): reserve a full refuel here plus the expected repair bill
 * (the average of the last five, or the named fallback until any bill exists), then find the
 * target ship's lowest-rarity slot — ties broken by the cheapest way up — and take the cheapest
 * net option the reserve-adjusted wallet allows. Nothing affordable → do nothing and keep
 * earning. A loose mining rig is fitted first when the ship has none: it is free, and both the
 * mining policy and the board's MINING contracts need it (an extra part a mission requirement
 * asks for).
 */
export function spendPlan(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  recentRepairBills: readonly number[],
  archetype: Archetype = 'chem',
): SpendPlan {
  const sheet = deriveSheet(installedParts(state.ship, catalogByType), rules);
  if (sheet.min < 1) {
    const rig = state.storage.find((part) => {
      const row = catalogByType.get(part.partType);
      return row !== undefined && familyBaseOf(row) === 'mining_rig' && row.active;
    });
    if (rig !== undefined && fitWouldBeViable(state, rules, catalogByType, rig)) {
      return {
        action: {
          kind: 'fit',
          storageId: rig.id,
          replaceId: null,
          targetBase: 'mining_rig',
          reason: 'fit-mining-rig',
        },
        keepNeeds: [],
      };
    }
  }
  const refill = refuelQuote(state, snapshot, rules, catalogByType, state.locationId);
  const bills = recentRepairBills.slice(-REPAIR_SAMPLE);
  const typicalBill =
    bills.length === 0
      ? REPAIR_BILL_FALLBACK_CREDITS
      : bills.reduce((sum, bill) => sum + bill, 0) / bills.length;
  // What repairing the whole ship costs right now is also owed: money that would leave the hull
  // unpaid for is not spendable, whatever the last few bills averaged.
  const fullRepair = repairQuote(state, snapshot, rules, catalogByType, state.locationId).cost;
  const expectedRepair = Math.max(typicalBill, fullRepair);
  const available = state.wallet - refill.cost - expectedRepair;
  const keepNeedsOfTarget = (target: SpendTarget): readonly MaterialNeed[] =>
    keepNeedsOf(target, rules);
  if (available < 1) {
    const first = spendTargetsOf(state, catalogByType, archetype)[0];
    return {
      action: { kind: 'none', reason: 'reserve' },
      keepNeeds: first === undefined ? [] : keepNeedsOfTarget(first),
    };
  }
  const ranked = spendTargetsOf(state, catalogByType, archetype)
    .map((target) => {
      const options = optionsFor(state, snapshot, rules, catalogByType, target);
      const minNet =
        options.length === 0
          ? Number.POSITIVE_INFINITY
          : Math.min(...options.map((option) => option.net));
      return { target, options, minNet };
    })
    .sort((left, right) => {
      const order = priorityBasesOf(archetype);
      return (
        priorityRankOf(order, left.target) - priorityRankOf(order, right.target) ||
        left.target.rarityIdx - right.target.rarityIdx ||
        left.minNet - right.minNet
      );
    });
  for (const rankedOne of ranked) {
    if (rankedOne.options.length === 0) continue;
    const affordable = rankedOne.options
      .filter((option) => option.cash <= available)
      .sort((left, right) => left.net - right.net);
    const chosen = affordable[0];
    if (chosen !== undefined) {
      return { action: chosen.action, keepNeeds: keepNeedsOfTarget(rankedOne.target) };
    }
    // The target is clear but out of reach: save for it rather than chasing a prouder slot.
    return {
      action: { kind: 'none', reason: `saving ${rankedOne.target.base}` },
      keepNeeds: keepNeedsOfTarget(rankedOne.target),
    };
  }
  return { action: { kind: 'none', reason: 'no-target' }, keepNeeds: [] };
}

export interface SellList {
  readonly partIds: readonly string[];
  readonly materials: readonly { readonly materialId: string; readonly quantity: number }[];
}

function rankBetter(left: ShipPartState, right: ShipPartState, catalogByType: ReadonlyMap<string, CatalogRow>): boolean {
  const leftRow = catalogByType.get(left.partType);
  const rightRow = catalogByType.get(right.partType);
  const leftIdx = leftRow === undefined ? -1 : rarityIndex(leftRow.rarity);
  const rightIdx = rightRow === undefined ? -1 : rarityIndex(rightRow.rarity);
  if (leftIdx !== rightIdx) return leftIdx > rightIdx;
  if (left.condition !== right.condition) return left.condition > right.condition;
  return left.id < right.id;
}

/**
 * What the surplus pass sells: every loose part that is not the ship's best candidate for a
 * target-ship slot (or its only mining rig while it has none), and every material unit above
 * what the next upgrade is counting on. Too damaged to sell is never offered. This is the plan's
 * "sell what is not part of the target ship and not needed for the next upgrade".
 */
export function sellList(
  state: PlayerState,
  snapshot: Snapshot,
  rules: GameRules,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  keepNeeds: readonly MaterialNeed[],
  archetype: Archetype = 'chem',
): SellList {
  const sheet = deriveSheet(installedParts(state.ship, catalogByType), rules);
  const keepParts = new Map<string, ShipPartState>();
  const partIds: string[] = [];
  for (const part of state.storage) {
    const row = catalogByType.get(part.partType);
    if (row === undefined) continue;
    const base = familyBaseOf(row);
    const worthKeeping =
      kitBasesOf(archetype).includes(base) ||
      (base === 'mining_rig' && sheet.min < 1 && row.active);
    if (!worthKeeping) {
      if (part.condition >= rules.economy.sell_min_condition) partIds.push(part.id);
      continue;
    }
    const current = keepParts.get(base);
    if (current === undefined || rankBetter(part, current, catalogByType)) {
      if (current !== undefined && current.condition >= rules.economy.sell_min_condition) {
        partIds.push(current.id);
      }
      keepParts.set(base, part);
    } else if (part.condition >= rules.economy.sell_min_condition) {
      partIds.push(part.id);
    }
  }
  const retention = retentionFor(state, snapshot, keepNeeds);
  const materials: { materialId: string; quantity: number }[] = [];
  for (const [materialId, held] of state.materials) {
    const kept = Math.min(held, retention.get(materialId) ?? 0);
    if (held - kept > 0) materials.push({ materialId, quantity: held - kept });
  }
  return { partIds, materials };
}
