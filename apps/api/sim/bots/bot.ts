/**
 * Phase 1 bot: one simulated player who picks a random qualifying offer, flies it with the real
 * resolver, and is restored for free between missions (so the loop itself can be measured before
 * fuel, repair and market policy land in Phase 2). When nothing qualifies, the clock waits for the
 * board to turn over — offers live 6–40 minutes, exactly like the game's.
 */
import { shipTier } from '../../src/ships/ship-tier.js';
import { deriveSheet } from '../../src/ships/sheet.deriver.js';
import {
  canTakeMission,
  missionContext,
  takeMission,
  type MissionContext,
  type MissionRunResult,
} from '../actions/mission.js';
import { calendarDays, createClock, DEFAULT_BUDGET, type PlayTimeBudget } from '../core/clock.js';
import { createRng } from '../core/rng.js';
import {
  catalogIndex,
  homeLocationOf,
  installedParts,
  shipValue,
  starterPlayer,
  type PlayerState,
} from '../core/state.js';
import { boardAt, buildFillerWorld, createBoard } from '../core/world.js';
import { travelOffer } from '../actions/travel.js';
import type { CatalogRow, Snapshot } from '../snapshot/types.js';

/** Consecutive board turns with nothing takeable before the run is declared stalled. */
const MAX_EMPTY_ROUNDS = 30;
/** Empty turns tolerated before the bot books a trip home (a port with no work for its ship). */
const STUCK_TRAVEL_ROUNDS = 2;
/** How long to wait when the board is empty of offers at all. */
const FALLBACK_WAIT_SECONDS = 60;
/** Full condition: the same `FULL_CONDITION` the resolver's pools use. */
const FULL_CONDITION = 100;
const RARITY_ORDER = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const;

export interface LevelRecord {
  readonly level: number;
  readonly t: number;
  readonly day: number;
  readonly missions: number;
  readonly wallet: number;
  readonly shipValue: number;
}

export interface MissionOutcomeRecord extends MissionRunResult {
  readonly seq: number;
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
  readonly temperament: 'random';
  readonly playstyle: 'generalist';
  readonly hoursPerDay: number;
  readonly totalSeconds: number;
  readonly totalMissions: number;
  readonly successRate: number;
  readonly finalLevel: number;
  readonly stalled: boolean;
  readonly stallReason: string | null;
  readonly ledgerTotals: ReturnType<PlayerState['ledger']['totals']>;
  readonly levels: LevelRecord[];
  readonly missions: MissionOutcomeRecord[];
}

export interface PlayRunInput {
  readonly snapshot: Snapshot;
  readonly seed: number;
  readonly missions: number;
  readonly factionId?: string;
  readonly budget?: PlayTimeBudget;
}

/** Rarity index of the installed bridge: the run's "level" (common = 1 … legendary = 5). */
export function bridgeLevelOf(state: PlayerState, catalogByType: ReadonlyMap<string, CatalogRow>): number {
  const bridge = state.ship.parts.find(
    (part) => catalogByType.get(part.partType)?.partClass === 'BRIDGE',
  );
  if (bridge === undefined) return 0;
  const rarity = catalogByType.get(bridge.partType)?.rarity ?? 'COMMON';
  const index = RARITY_ORDER.indexOf(rarity);
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

/** Phase 1's free restore: wear is healed and the tank is filled between missions, at no cost. */
function restoreForFree(state: PlayerState, ctx: MissionContext): void {
  for (const part of state.ship.parts) {
    part.condition = FULL_CONDITION;
  }
  state.ship.fuel = deriveSheet(installedParts(state.ship, ctx.catalogByType), ctx.rules).fuelCap;
}

function baseEpochMs(snapshot: Snapshot): number {
  const parsed = Date.parse(snapshot.takenAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Plays one game: `missions` accepted missions from a fresh starter ship, seeded end to end. */
export function playRun(input: PlayRunInput): RunResult {
  const { snapshot, seed, missions } = input;
  const factionId = input.factionId ?? defaultFaction(snapshot);
  const budget = input.budget ?? DEFAULT_BUDGET;
  const ctx = missionContext(snapshot);
  const state = starterPlayer(snapshot, factionId, { clock: createClock() });
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

  while (state.missionsDone < missions) {
    const nowMs = baseMs + state.clock.now() * 1000;
    const offers = boardAt({
      board,
      snapshot,
      world,
      rules: ctx.rules,
      state,
      locationId: state.locationId,
      nowMs,
    });
    const qualifying = offers.filter((offer) => canTakeMission(state, offer, ctx).ok);

    if (qualifying.length === 0) {
      emptyRounds += 1;
      if (emptyRounds > MAX_EMPTY_ROUNDS) {
        stalled = true;
        stallReason = `nothing takeable for ${emptyRounds} board turns`;
        break;
      }
      // A port whose only work the ship cannot do is not a place to starve: book a trip home
      // (the game's own TRAVEL flow — no pay, only the fuel) and try again from there.
      if (emptyRounds % STUCK_TRAVEL_ROUNDS === 0) {
        const home = homeLocationOf(snapshot, factionId);
        const trip = travelOffer({ snapshot, world, state, destinationId: home, nowMs });
        if (trip !== null && canTakeMission(state, trip, ctx).ok) {
          takeMission(state, trip, ctx);
          // Repositioning is not "a mission played": it does not count toward the run's target.
          state.missionsDone -= 1;
          restoreForFree(state, ctx);
          state.clock.advance(budget.humanPauseSeconds);
          state.log.push(`stuck at ${state.locationId} — travelled home to ${home}`);
          emptyRounds = 0;
          continue;
        }
      }
      // Wait until the earliest live offer actually expires so the board regenerates.
      // (Seeding Math.min with nowMs + fallback would always yield the fallback,
      //  freezing the board forever when nothing is takeable.)
      const nextExpiry = offers.reduce(
        (earliest, offer) => Math.min(earliest, offer.expiresAtMs),
        Number.POSITIVE_INFINITY,
      );
      const waitSeconds = Number.isFinite(nextExpiry)
        ? Math.max(1, Math.ceil((nextExpiry - nowMs) / 1000))
        : FALLBACK_WAIT_SECONDS;
      state.clock.advance(waitSeconds);
      continue;
    }
    emptyRounds = 0;

    const offer = rng.child(`pick-${state.missionsDone}`).pick(qualifying);
    const beforeLevel = bridgeLevelOf(state, catalogByType);
    const result = takeMission(state, offer, ctx);

    if (result.shipStatus === 'ADRIFT') {
      // Phase 1: the free restore doubles as the tow back to port (rescue lands later).
      state.log.push(`adrift after ${result.offerId} — towed back to ${state.locationId}`);
    }
    restoreForFree(state, ctx);
    state.clock.advance(budget.humanPauseSeconds);

    const installed = installedParts(state.ship, ctx.catalogByType);
    records.push({
      ...result,
      seq: state.missionsDone,
      t: state.clock.now(),
      day: calendarDays(state.clock.now(), budget),
      wallet: state.wallet,
      shipValue: shipValue(state.ship, catalogByType),
      bridgeLevel: bridgeLevelOf(state, catalogByType),
      shipTier: shipTier(
        installed.map((part) => ({ basePrice: part.catalog.basePrice })),
        ctx.rules,
      ),
    });
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
    temperament: 'random',
    playstyle: 'generalist',
    hoursPerDay: budget.hoursPerDay,
    totalSeconds: state.clock.now(),
    totalMissions: records.length,
    successRate: records.length === 0 ? 0 : successes / records.length,
    finalLevel: levels[levels.length - 1]?.level ?? 1,
    stalled,
    stallReason,
    ledgerTotals: state.ledger.totals(),
    levels,
    missions: records,
  };
}

/** The playable faction the sim defaults to (the first home in the onboarding map). */
export function defaultFaction(snapshot: Snapshot): string {
  const homes = snapshot.rules.onboarding.home_locations as unknown as Record<string, string>;
  const first = Object.keys(homes)[0];
  if (first === undefined) throw new Error('rules.onboarding.home_locations is empty');
  return first;
}
