/**
 * The bot: one simulated player who picks a random qualifying offer, flies it with the real
 * resolver, and buys fuel and repairs at real prices between missions. The loop is the same
 * decision process a human pilot runs — check the board, fly something, decide where (and whether)
 * to refuel and repair, repeat — with every money and time figure coming from the game's own
 * pure calculators. When nothing qualifies, the clock waits for the board to turn over.
 */
import { shipTier } from '../../src/ships/ship-tier.js';
import {
  canTakeMission,
  missionContext,
  takeMission,
  type MissionContext,
} from '../actions/mission.js';
import { refuel, refuelQuote } from '../actions/fuel.js';
import { repair } from '../actions/repair.js';
import { rescue, rescueQuote } from '../actions/rescue.js';
import { travel } from '../actions/travel.js';
import { calendarDays, createClock, DEFAULT_BUDGET, type PlayTimeBudget } from '../core/clock.js';
import { createRng } from '../core/rng.js';
import {
  catalogIndex,
  installedParts,
  shipValue,
  starterPlayer,
  type PlayerState,
} from '../core/state.js';
import { boardAt, buildFillerWorld, createBoard, type Offer } from '../core/world.js';
import type { CatalogRow, Snapshot } from '../snapshot/types.js';
import {
  cheapestReachablePort,
  canTravelTo,
  decideDanger,
  decideFuel,
  decideRepair,
  missionFuelNeed,
  repositionOffer,
} from './policy.js';

/** Consecutive board turns with nothing takeable before the run is declared stalled. */
const MAX_EMPTY_ROUNDS = 30;
/** Empty board turns tolerated before the pilot calls a rescue (a board can be thin for a while). */
const RESCUE_AFTER_EMPTY_ROUNDS = 3;
/** Rescue attempts after that point before the run is declared stalled (a rescue that buys
 *  nothing is a money pit, so the pilot gives up rather than pay for a tow forever). */
const RESCUE_MAX_ATTEMPTS = 3;
/** How long to wait when the board is empty of offers at all. */
const FALLBACK_WAIT_SECONDS = 60;

export interface LevelRecord {
  readonly level: number;
  readonly t: number;
  readonly day: number;
  readonly missions: number;
  readonly wallet: number;
  readonly shipValue: number;
}

export interface MissionOutcomeRecord {
  readonly seq: number;
  readonly offerId: string;
  readonly type: string;
  readonly templateId: string;
  readonly originId: string;
  readonly destinationId: string;
  readonly distance: number;
  readonly maxDanger: number;
  readonly zone: number;
  readonly rewardOffered: number;
  readonly rewardPaid: number;
  readonly status: string;
  readonly integrity: number;
  readonly durationSeconds: number;
  readonly fuelBurned: number;
  readonly wearPoints: number;
  readonly fights: number;
  readonly wins: number;
  readonly losses: number;
  readonly scrapFound: number;
  readonly partsFound: number;
  readonly t: number;
  readonly day: number;
  readonly wallet: number;
  readonly shipValue: number;
  readonly bridgeLevel: number;
  readonly shipTier: number;
}

export interface RunResult {
  readonly seed: number;
  readonly factionId: string;
  readonly temperament: string;
  readonly playstyle: string;
  readonly hoursPerDay: number;
  readonly totalSeconds: number;
  readonly totalMissions: number;
  readonly successRate: number;
  readonly finalLevel: number;
  readonly stalled: boolean;
  readonly stallReason: string | null;
  readonly startWallet: number;
  readonly finalWallet: number;
  readonly ledgerTotals: ReturnType<PlayerState['ledger']['totals']>;
  readonly levels: LevelRecord[];
  readonly missions: MissionOutcomeRecord[];
  readonly log: string[];
}

export interface PlayRunInput {
  readonly snapshot: Snapshot;
  readonly seed: number;
  readonly missions: number;
  readonly factionId?: string;
  readonly budget?: PlayTimeBudget;
  readonly temperament?: string;
  readonly playstyle?: string;
}

function bridgeLevelOf(state: PlayerState, catalogByType: ReadonlyMap<string, CatalogRow>): number {
  const bridge = state.ship.parts.find(
    (part) => catalogByType.get(part.partType)?.partClass === 'BRIDGE',
  );
  if (bridge === undefined) return 0;
  const rarity = catalogByType.get(bridge.partType)?.rarity ?? 'COMMON';
  const order = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];
  const index = order.indexOf(rarity);
  return index === -1 ? 1 : index + 1;
}

function levelRecord(
  state: PlayerState,
  catalogByType: ReadonlyMap<string, CatalogRow>,
  budget: PlayTimeBudget,
): LevelRecord {
  return {
    level: bridgeLevelOf(state, catalogByType),
    t: state.clock.now(),
    day: calendarDays(state.clock.now(), budget),
    missions: state.missionsDone,
    wallet: state.wallet,
    shipValue: shipValue(state.ship, catalogByType),
  };
}

function baseEpochMs(snapshot: Snapshot): number {
  const parsed = Date.parse(snapshot.takenAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Why nothing on the board was takeable — the stall report's real content. */
function diagnoseBoard(
  offers: readonly Offer[],
  state: PlayerState,
  ctx: MissionContext,
): string {
  if (offers.length === 0) return 'board empty';
  const reasons = offers.map((offer) => {
    const take = canTakeMission(state, offer, ctx);
    if (!take.ok) return take.reasons.join('+');
    return decideDanger(state, ctx.catalogByType, offer).reason;
  });
  return [...new Set(reasons)].join(', ');
}

/** The emergency ration a tow would top the tank up to. Below it, the pilot is dry enough that a
 *  tow is worth paying for; above it, the tow buys nothing but the bill. */
function rescueRationOf(state: PlayerState, ctx: MissionContext): number {
  return rescueQuote(state, ctx.snapshot, ctx.rules, ctx.catalogByType).ration;
}

/** Can the ship reach *any* port on its current tank? If not, it is stuck where it stands with no
 *  self-rescue route, and the only way out is a tow. This is deliberately stricter than "is there
 *  an offer": a ship that cannot reach anywhere at all has no exit, offer or not. */
function canReachAnywhereSafe(
  state: PlayerState,
  ctx: MissionContext,
  world: ReturnType<typeof buildFillerWorld>,
  nowMs: number,
): boolean {
  const anywhere = world.locations.some(
    (loc) => loc.id !== state.locationId && canTravelTo(state, ctx, world, loc.id, nowMs),
  );
  return anywhere;
}

/** Pick a random qualifying offer — the "random" temperament's only decision. */
function pickOffer(
  state: PlayerState,
  ctx: MissionContext,
  world: ReturnType<typeof buildFillerWorld>,
  board: ReturnType<typeof createBoard>,
  rng: ReturnType<typeof createRng>,
  nowMs: number,
): { offer: Offer | null; offers: Offer[] } {
  const offers = boardAt({
    board,
    snapshot: ctx.snapshot,
    world,
    rules: ctx.rules,
    state,
    locationId: state.locationId,
    nowMs,
  });
  const qualifying = offers.filter(
    (offer) =>
      canTakeMission(state, offer, ctx).ok &&
      decideDanger(state, ctx.catalogByType, offer).accept,
  );
  if (qualifying.length === 0) return { offer: null, offers };
  const offer = rng.child(`pick-${state.missionsDone}`).pick(qualifying);
  return { offer, offers };
}

function recordOutcome(
  state: PlayerState,
  ctx: MissionContext,
  budget: PlayTimeBudget,
  result: ReturnType<typeof takeMission>,
): MissionOutcomeRecord {
  const installed = installedParts(state.ship, ctx.catalogByType);
  return {
    seq: state.missionsDone,
    offerId: result.offerId,
    type: result.type,
    templateId: result.templateId,
    originId: result.originId,
    destinationId: result.destinationId,
    distance: result.distance,
    maxDanger: result.maxDanger,
    zone: result.zone,
    rewardOffered: result.rewardOffered,
    rewardPaid: result.rewardPaid,
    status: result.status,
    integrity: result.integrity,
    durationSeconds: result.durationSeconds,
    fuelBurned: result.fuelBurned,
    wearPoints: result.wearPoints,
    fights: result.fights,
    wins: result.wins,
    losses: result.losses,
    scrapFound: result.scrapFound,
    partsFound: result.partsFound,
    t: state.clock.now(),
    day: calendarDays(state.clock.now(), budget),
    wallet: state.wallet,
    shipValue: shipValue(state.ship, ctx.catalogByType),
    bridgeLevel: bridgeLevelOf(state, ctx.catalogByType),
    shipTier: shipTier(
      installed.map((part) => ({ basePrice: part.catalog.basePrice })),
      ctx.rules,
    ),
  };
}

/** Plays one game: `missions` accepted missions from a fresh starter ship, seeded end to end. */
export function playRun(input: PlayRunInput): RunResult {
  const { snapshot, seed, missions } = input;
  const factionId = input.factionId ?? defaultFaction(snapshot);
  const budget = input.budget ?? DEFAULT_BUDGET;
  const temperament = input.temperament ?? 'random';
  const playstyle = input.playstyle ?? 'generalist';
  const ctx = missionContext(snapshot);
  const state = starterPlayer(snapshot, factionId, { clock: createClock() });
  const startWallet = state.wallet;
  const world = buildFillerWorld(snapshot);
  const board = createBoard();
  const rng = createRng(seed);
  const baseMs = baseEpochMs(snapshot);
  const catalogByType = catalogIndex(snapshot);

  const levels: LevelRecord[] = [levelRecord(state, catalogByType, budget)];
  const records: MissionOutcomeRecord[] = [];
  let stalled = false;
  let stallReason: string | null = null;
  let emptyRounds = 0;
  let rescuesTaken = 0;

  while (state.missionsDone < missions) {
    const nowMs = baseMs + state.clock.now() * 1000;
    const picked = pickOffer(state, ctx, world, board, rng, nowMs);
    const { offer, offers } = picked;

    if (offer === null) {
      emptyRounds += 1;
      if (process.env['SIM_DEBUG'] === '1') {
        const parts = state.ship.parts
          .map((p) => catalogByType.get(p.partType)?.partClass ?? '?')
          .join(',');
        process.stderr.write(
          `[stall] @${state.locationId} fuel=${state.ship.fuel} wallet=${state.wallet} ` +
            `parts=[${parts}] offers=${offers.length} reasons=${diagnoseBoard(offers, state, ctx)}\n`,
        );
      }
      // A rescue that buys nothing is a money pit. The pilot will pay for a few tows — a stranded
      // ship has no other way home — but once they stop yielding takeable work the run is over,
      // and the stall must be reported rather than the wallet drained on a loop.
      if (rescuesTaken >= RESCUE_MAX_ATTEMPTS || emptyRounds > MAX_EMPTY_ROUNDS) {
        stalled = true;
        stallReason = `nothing takeable for ${emptyRounds} board turns @ ${state.locationId}` +
          `: ${diagnoseBoard(offers, state, ctx)}`;
        state.log.push(stallReason);
        break;
      }
      // The board has work the pilot can afford but cannot fly: fuel is the only rejection.
      // Buying the shortfall for the cheapest such job turns a rejection into a takeoff — the
      // "next mission" is right here, so this is the minimum a pilot owes the port they sit at.
      const unlockable = offers
        .filter((offer) => {
          const take = canTakeMission(state, offer, ctx);
          if (!take.ok && take.reasons.some((reason) => reason !== 'NOT_ENOUGH_FUEL')) {
            return false;
          }
          return decideDanger(state, ctx.catalogByType, offer).accept;
        })
        .map((offer) => ({
          offer,
          need: missionFuelNeed(state, offer, { rules: ctx.rules, catalogByType }),
        }))
        .filter(({ need }) => need > state.ship.fuel)
        .sort((left, right) => left.need - right.need);
      const cheapestUnlock = unlockable[0];
      if (cheapestUnlock !== undefined) {
        const shortfall = cheapestUnlock.need - state.ship.fuel;
        const quote = refuelQuote(
          state, snapshot, ctx.rules, catalogByType, state.locationId, shortfall,
        );
        if (quote.cost <= state.wallet) {
          refuel(state, snapshot, ctx.rules, catalogByType, state.locationId, shortfall);
          state.log.push(
            `refuelled ${quote.units} at ${state.locationId} for ${quote.cost} ` +
              `(wallet ${state.wallet})`,
          );
          state.clock.advance(budget.humanPauseSeconds);
          emptyRounds = 0;
          continue;
        }
      }
      // Before paying for a tow, the pilot buys a way out: a hop to the cheapest port, priced as
      // a mission and refuelled like any other. The board here offers nothing, so leaving is the
      // offer. This is what keeps the run alive when a port's board is thin or all hard — the
      // pilot does not wait to be rescued, they go looking for work.
      const hop = repositionOffer(state, snapshot, ctx.rules, catalogByType, world, nowMs);
      if (hop !== null) {
        const need = missionFuelNeed(state, hop, { rules: ctx.rules, catalogByType });
        const shortfall = need - state.ship.fuel;
        if (shortfall > 0) {
          const quote = refuelQuote(
            state, snapshot, ctx.rules, catalogByType, state.locationId, shortfall,
          );
          if (quote.cost <= state.wallet) {
            refuel(
              state, snapshot, ctx.rules, catalogByType, state.locationId, shortfall,
            );
          }
        }
        if (state.ship.fuel >= need) {
          const from = state.locationId;
          const trip = travel(state, ctx, world, hop.destinationId, nowMs);
          state.missionsDone -= 1;
          state.clock.advance(budget.humanPauseSeconds);
          state.log.push(
            `hopped ${from} -> ${trip?.destinationId ?? hop.destinationId} for work ` +
              `(wallet ${state.wallet})`,
          );
          emptyRounds = 0;
          continue;
        }
      }
      // A rescue is how a stranded pilot gets back to safety: a tow to the nearest base, at the
      // game's price, with an emergency ration when the tank is dry. The ship keeps every part —
      // the tow buys a way home, not a new build. It fires only when the pilot cannot reach any
      // other port, or has bought their way as far as they can and still has no work.
      const dry = state.ship.fuel < rescueRationOf(state, ctx);
      if (!canReachAnywhereSafe(state, ctx, world, nowMs) ||
          (emptyRounds >= RESCUE_AFTER_EMPTY_ROUNDS && dry)) {
        const out = rescue(state, ctx.snapshot, ctx.rules, catalogByType);
        state.log.push(
          `stranded at ${state.locationId} — rescued for ${out.cost} ` +
            `(ration +${out.rationAdded}, wallet ${state.wallet})`,
        );
        state.clock.advance(budget.humanPauseSeconds);
        emptyRounds = 0;
        rescuesTaken += 1;
        continue;
      }
      // Wait until the earliest live offer actually expires so the board regenerates.
      const nextExpiry = offers.reduce(
        (earliest, o) => Math.min(earliest, o.expiresAtMs),
        Number.POSITIVE_INFINITY,
      );
      const waitSeconds = Number.isFinite(nextExpiry)
        ? Math.max(1, Math.ceil((nextExpiry - nowMs) / 1000))
        : FALLBACK_WAIT_SECONDS;
      state.clock.advance(waitSeconds);
      continue;
    }
    emptyRounds = 0;

    // Before flying: decide whether to repair and where (the plan's "buy at the right port" rule).
    const repairDecision = decideRepair(state, snapshot, ctx.rules, catalogByType);
    if (repairDecision.shouldRepair) {
      repair(state, snapshot, ctx.rules, catalogByType, state.locationId);
      state.clock.advance(budget.humanPauseSeconds);
    } else if (repairDecision.reason === 'travel-to-cheap-repair') {
      const target = cheapestReachablePort(state, snapshot, ctx.rules, catalogByType);
      if (target !== null && canTravelTo(state, ctx, world, target, nowMs)) {
        travel(state, ctx, world, target, nowMs);
        state.missionsDone -= 1;
        state.clock.advance(budget.humanPauseSeconds);
        repair(state, snapshot, ctx.rules, catalogByType, target);
        continue;
      }
    }

    // Before flying: decide whether to refuel, and how much (the plan's exact rule).
    const fuelDecision = decideFuel(state, snapshot, ctx.rules, catalogByType, offer);
    if (fuelDecision.shouldRefuel) {
      refuel(
        state,
        snapshot,
        ctx.rules,
        catalogByType,
        state.locationId,
        fuelDecision.units,
      );
      state.clock.advance(budget.humanPauseSeconds);
    }

    const beforeLevel = bridgeLevelOf(state, catalogByType);
    const result = takeMission(state, offer, ctx);
    state.clock.advance(budget.humanPauseSeconds);

    // Fuel ran out mid-route: the live game leaves the hull ADRIFT until a rescue tows it to a
    // base — a debit that may go negative, plus the emergency ration (rescue.service.ts). Phase 1
    // towed adrift ships for free; that restore is gone now that rescue has landed.
    if (result.shipStatus === 'ADRIFT') {
      const tow = rescue(state, ctx.snapshot, ctx.rules, catalogByType);
      state.log.push(
        `adrift after ${result.type} — towed for ${tow.cost} ` +
          `(ration +${tow.rationAdded}, wallet ${state.wallet})`,
      );
    }

    records.push(recordOutcome(state, ctx, budget, result));
    if (bridgeLevelOf(state, catalogByType) > beforeLevel) {
      levels.push(levelRecord(state, catalogByType, budget));
    }
  }

  const successes = records.filter(
    (record) => record.status === 'success' || record.status === 'partial_failure',
  ).length;
  return {
    seed,
    factionId,
    temperament,
    playstyle,
    hoursPerDay: budget.hoursPerDay,
    totalSeconds: state.clock.now(),
    totalMissions: records.length,
    successRate: records.length === 0 ? 0 : successes / records.length,
    finalLevel: levels[levels.length - 1]?.level ?? 1,
    stalled,
    stallReason,
    startWallet,
    finalWallet: state.wallet,
    ledgerTotals: state.ledger.totals(),
    levels,
    missions: records,
    log: state.log,
  };
}

/** The playable faction the sim defaults to (the first home in the onboarding map). */
export function defaultFaction(snapshot: Snapshot): string {
  const homes = snapshot.rules.onboarding.home_locations as unknown as Record<string, string>;
  const first = Object.keys(homes)[0];
  if (first === undefined) throw new Error('rules.onboarding.home_locations is empty');
  return first;
}
