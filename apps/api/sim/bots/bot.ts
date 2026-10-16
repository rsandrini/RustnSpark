/**
 * The bot: one simulated player who picks a random qualifying offer, flies it with the real
 * resolver, and buys fuel and repairs at real prices between missions. The loop is the same
 * decision process a human pilot runs — check the board, fly something, decide where (and whether)
 * to refuel and repair, repeat — with every money and time figure coming from the game's own
 * pure calculators. When nothing qualifies, the clock waits for the board to turn over.
 */
import { shipTier } from '../../src/ships/ship-tier.js';
import { deriveSheet } from '../../src/ships/sheet.deriver.js';
import { checkViability } from '../../src/ships/viability.js';
import { isDead } from '../../src/parts/condition.js';
import {
  canTakeMission,
  missionContext,
  takeMission,
  type MissionContext,
} from '../actions/mission.js';
import { refuel, refuelQuote } from '../actions/fuel.js';
import { repair, repairQuote } from '../actions/repair.js';
import { rescue, rescueQuote } from '../actions/rescue.js';
import { travel, travelOffer } from '../actions/travel.js';
import { canMine, mine, miningOffer } from '../actions/mining.js';
import { scavenge, scavengeCooldownLeft, scavengeOffer } from '../actions/scavenge.js';
import { buyListing, fitPart, sellMaterial, sellPart, unfitPart } from '../actions/market.js';
import { upgrade } from '../actions/upgrade.js';
import {
  calendarDays,
  createClock,
  DEFAULT_BUDGET,
  type Clock,
  type PlayTimeBudget,
} from '../core/clock.js';
import { createRng } from '../core/rng.js';
import {
  catalogIndex,
  installedParts,
  shipLevel,
  shipValue,
  starterPlayer,
  type PlayerState,
} from '../core/state.js';
import { boardAt, buildFillerWorld, createBoard, type Offer } from '../core/world.js';
import type { CatalogRow, Snapshot } from '../snapshot/types.js';
import { chooseOffer, temperamentOf, type Temperament } from './temperament.js';
import {
  filterForPlaystyle,
  playstyleAllowsJob,
  playstyleOf,
  type Playstyle,
} from './playstyle.js';
import { archetypeOf } from './archetype.js';
import type { BridgeScaling } from '../experiment/scaling.js';
import {
  canTravelTo,
  cheapestReachablePort,
  decideDanger,
  decideFuel,
  decideRepair,
  MINE_RATIO_MIN,
  MAX_SHIP_LEVEL,
  missionFuelNeed,
  needsRepair,
  PLAYTIME_CAP_SECONDS,
  PROGRESS_STALL_MISSIONS,
  affordableRepairTargets,
  atOrBelowTarget,
  idleInstalledParts,
  RATIO_WINDOW,
  repositionOffer,
  SCAVENGE_RATIO_MIN,
  sellList,
  spendPlan,
  type SpendAction,
} from './policy.js';
import { FALLBACK_REPAIR_PER_POINT, isWorthFlying, tripKey, type WearSample } from './prudence.js';

/** How many flown missions the pilot remembers the wear of. */
const WEAR_SAMPLE_WINDOW = 30;
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

/** How many fits, buys and upgrades the pilot chains at one stop before moving on. */
const MAX_SPEND_STEPS_PER_STOP = 8;

export interface RunResult {
  readonly seed: number;
  readonly factionId: string;
  readonly temperament: string;
  readonly playstyle: string;
  readonly archetype: string;
  readonly hoursPerDay: number;
  readonly totalSeconds: number;
  readonly totalMissions: number;
  readonly successRate: number;
  readonly finalLevel: number;
  readonly stalled: boolean;
  readonly stallReason: string | null;
  /** Why the run stopped: `missions` budget, `ship-level`, `playtime`, or a stall kind. */
  readonly endReason: string;
  readonly startWallet: number;
  readonly finalWallet: number;
  readonly ledgerTotals: ReturnType<PlayerState['ledger']['totals']>;
  /** Scavenge jobs flown (not missions — the report shows them separately). */
  readonly scavengesDone: number;
  /** Free mining jobs flown. */
  readonly miningDone: number;
  /** Scavenging jobs done on foot, what fitted finds saved, repair actions paid, the final kit. */
  readonly footScavenges: number;
  readonly findsValue: number;
  readonly repairActions: number;
  readonly finalParts: readonly string[];
  readonly levels: LevelRecord[];
  readonly missions: MissionOutcomeRecord[];
  readonly log: string[];
  /** Simulated seconds attributed to each action kind (mission, scavenge, repair, ...). */
  readonly actionSeconds: Readonly<Record<string, number>>;
}

export interface PlayRunInput {
  readonly snapshot: Snapshot;
  readonly seed: number;
  readonly missions: number;
  readonly factionId?: string;
  readonly budget?: PlayTimeBudget;
  readonly temperament?: string;
  readonly playstyle?: string;
  /** The build the pilot grows toward (`chem` | `chem-shield` | `ion-shield`). */
  readonly archetype?: string;
  /** The what-if table: rewards and numeric requirements scale by bridge rarity. */
  readonly bridgeScaling?: BridgeScaling;
  /** Sanity bot: never sells, buys, fits, upgrades or repairs — it must stagnate. */
  readonly noSpend?: boolean;
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
    level: shipLevel(state.ship, catalogByType),
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
function diagnoseBoard(offers: readonly Offer[], state: PlayerState, ctx: MissionContext): string {
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

/** Pick a qualifying offer — the playstyle filters the board, the temperament orders it. */
function pickOffer(
  state: PlayerState,
  ctx: MissionContext,
  world: ReturnType<typeof buildFillerWorld>,
  board: ReturnType<typeof createBoard>,
  rng: ReturnType<typeof createRng>,
  nowMs: number,
  temperament: Temperament,
  playstyle: Playstyle,
  memory: PilotMemory,
): { offer: Offer | null; offers: Offer[]; fallback: boolean } {
  const offers = boardAt({
    board,
    snapshot: ctx.snapshot,
    world,
    rules: ctx.rules,
    state,
    locationId: state.locationId,
    nowMs,
  });
  const takeable = offers.filter(
    (offer) =>
      canTakeMission(state, offer, ctx).ok && decideDanger(state, ctx.catalogByType, offer).accept,
  );
  // Prudence: not a trip that just stranded this ship (until the tank is bigger), the fuel the
  // pump's worst case needs aboard, and nothing whose repair bill eats its reward, unless that
  // leaves nothing at all to fly (then the pilot takes the work rather than sit).
  const repairPerPoint = repairCostPerPoint(state, ctx);
  const fuelCap = fuelCapOfShip(state, ctx);
  const prudent = takeable.filter(
    (offer) =>
      state.ship.fuel >= missionFuelNeed(state, offer, ctx) &&
      !(
        memory.stranded.get(tripKey(offer)) !== undefined &&
        fuelCap <= (memory.stranded.get(tripKey(offer)) ?? 0)
      ),
  );
  const worthIt = prudent.filter((offer) =>
    isWorthFlying(offer, memory.wearSamples, repairPerPoint),
  );
  const qualifying = worthIt.length > 0 ? worthIt : prudent;
  if (qualifying.length === 0) return { offer: null, offers, fallback: false };
  const { kept, fallback } = filterForPlaystyle(playstyle, qualifying);
  const offer = chooseOffer(temperament, kept, state, ctx, rng);
  return { offer, offers, fallback };
}

/** What the pilot remembers of this run: wear per trip and the trips that ran the ship dry. */
interface PilotMemory {
  readonly wearSamples: WearSample[];
  /** Trip key -> the tank capacity the ship had when it was stranded there. */
  readonly stranded: Map<string, number>;
}

function repairCostPerPoint(state: PlayerState, ctx: MissionContext): number {
  const quote = repairQuote(state, ctx.snapshot, ctx.rules, ctx.catalogByType, state.locationId);
  return quote.points > 0 ? quote.cost / quote.points : FALLBACK_REPAIR_PER_POINT;
}

function fuelCapOfShip(state: PlayerState, ctx: MissionContext): number {
  return deriveSheet(installedParts(state.ship, ctx.catalogByType), ctx.rules).fuelCap;
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
  const factionId = input.factionId ?? factionForSeed(snapshot, seed);
  const budget = input.budget ?? DEFAULT_BUDGET;
  const temperament = temperamentOf(input.temperament ?? 'random');
  const playstyle = playstyleOf(input.playstyle ?? 'generalist');
  const archetype = archetypeOf(input.archetype ?? 'chem');
  const ctx = missionContext(snapshot, input.bridgeScaling);
  const noSpend = input.noSpend ?? false;
  /** The sanity bot's switch: off, it never touches the market, the pump or the tow. */
  const spend = !noSpend;
  // Every second the clock moves is attributed to the action that moved it, so the experiment
  // report can show where a cell's pilots spent their playtime.
  const actionSeconds: Record<string, number> = {};
  let currentAction = 'idle';
  const baseClock = createClock();
  const attributedClock: Clock = {
    now: () => baseClock.now(),
    advance: (seconds: number) => {
      actionSeconds[currentAction] = (actionSeconds[currentAction] ?? 0) + seconds;
      baseClock.advance(seconds);
    },
  };
  const state = starterPlayer(snapshot, factionId, { clock: attributedClock });
  const startWallet = state.wallet;
  const world = buildFillerWorld(snapshot);
  const board = createBoard(seed);
  const rng = createRng(seed);
  const baseMs = baseEpochMs(snapshot);
  const catalogByType = catalogIndex(snapshot);

  const levels: LevelRecord[] = [levelRecord(state, catalogByType, budget)];
  const records: MissionOutcomeRecord[] = [];
  let stalled = false;
  let stallReason: string | null = null;
  let emptyRounds = 0;
  /** The last empty board was blocked by mining work the ship has no rig for. */
  let minerBlocked = false;
  let rescuesTaken = 0;
  // Phase 3: ratio windows over mission opportunities, the repair bills the reserve averages,
  // and the wallet trail the progress-stall detector compares against.
  const scavengeFlags: boolean[] = [];
  const mineFlags: boolean[] = [];
  const recentRepairBills: number[] = [];
  const memory: PilotMemory = { wearSamples: [], stranded: new Map() };
  const walletTrail: { mission: number; wallet: number }[] = [{ mission: 0, wallet: state.wallet }];
  let lastLevel = levels[0]?.level ?? 1;
  let levelChangeAt = 0;
  let endReason = 'missions';

  /** Execute the spending plan: fit, buy, upgrade, or hop to the cheaper port first. */
  function executeSpend(action: SpendAction, nowMs: number): boolean {
    switch (action.kind) {
      case 'none':
        return false;
      case 'fit': {
        currentAction = 'market';
        const out = fitPart(
          state,
          ctx.rules,
          catalogByType,
          action.storageId,
          action.replaceId ?? undefined,
        );
        if (out.ok) {
          state.log.push(`fitted ${action.storageId} (${action.reason})`);
        } else if (process.env['SIM_DEBUG'] === '1') {
          process.stderr.write(
            `[fit] ${action.storageId} -> ${action.replaceId ?? 'slot'} failed: ${out.reason}\n`,
          );
        }
        return false;
      }
      case 'buy': {
        currentAction = 'market';
        const out = buyListing(state, snapshot, ctx.rules, catalogByType, action.listingId);
        if (!out.ok || out.partId === undefined || out.price === undefined) return false;
        const fit = fitPart(
          state,
          ctx.rules,
          catalogByType,
          out.partId,
          action.replaceId ?? undefined,
        );
        const used =
          out.condition !== undefined && out.condition < 100 ? ` used@${out.condition}` : '';
        state.log.push(
          `bought ${action.partType} at ${action.locationId} for ${out.price}${used} ` +
            `(wallet ${state.wallet})${fit.ok ? '' : ' — kept in the hold'}`,
        );
        return false;
      }
      case 'upgrade': {
        currentAction = 'market';
        const out = upgrade(state, snapshot, ctx.rules, catalogByType, action.partId);
        if (out.ok) {
          state.log.push(`upgraded to ${out.partType} for ${out.cost} (wallet ${state.wallet})`);
        }
        return false;
      }
      case 'travel-to-buy': {
        currentAction = 'travel';
        const target = action.locationId;
        const hop = travelOffer({ snapshot, world, state, destinationId: target, nowMs });
        if (hop === null) return false;
        // A buy port is not worth a fight the pilot would refuse as a mission: same danger rule
        // as work, checked before a credit is spent on the tank.
        if (!decideDanger(state, catalogByType, hop).accept) return false;
        const need = missionFuelNeed(state, hop, { rules: ctx.rules, catalogByType });
        // Pay for the shortfall *before* judging the hop: the refusal the plan is answering is
        // NOT_ENOUGH_FUEL, and gating on it first made this refuel unreachable — the buy port
        // had to wait for some other errand to fill the tank.
        const shortfall = need - state.ship.fuel;
        if (shortfall > 0) {
          const quote = refuelQuote(
            state,
            snapshot,
            ctx.rules,
            catalogByType,
            state.locationId,
            shortfall,
          );
          if (quote.cost <= state.wallet) {
            refuel(state, snapshot, ctx.rules, catalogByType, state.locationId, shortfall);
          } else if (process.env['SIM_DEBUG'] === '1') {
            process.stderr.write(
              `[hop2buy] refuel blocked: shortfall ${shortfall} costs ${quote.cost} > wallet ${state.wallet}\n`,
            );
          }
        }
        const take = canTakeMission(state, hop, ctx);
        if (process.env['SIM_DEBUG'] === '1') {
          process.stderr.write(
            `[hop2buy] @${state.locationId} -> ${target} hop=ok ` +
              `take=${take.ok ? 'ok' : take.reasons.join('+')} ` +
              `fuel=${state.ship.fuel} need=${need} wallet=${state.wallet}\n`,
          );
        }
        if (!take.ok) return false;
        if (state.ship.fuel < need) return false;
        const from = state.locationId;
        const trip = travel(state, ctx, world, target, nowMs);
        if (trip === null) return false;
        state.missionsDone -= 1;
        state.clock.advance(budget.humanPauseSeconds);
        // A trip that failed to arrive is not a hop: the hull stays put (adrift, until the tow
        // below brings it back) and the plan gets to try again next turn.
        towIfAdrift(trip.shipStatus, 'buy-hop');
        const arrived =
          (trip.status === 'success' || trip.status === 'partial_failure') &&
          trip.shipStatus !== 'ADRIFT';
        if (!arrived) {
          if (process.env['SIM_DEBUG'] === '1') {
            process.stderr.write(
              `[hop2buy] trip failed: status=${trip.status} shipStatus=${trip.shipStatus}\n`,
            );
          }
          return false;
        }
        state.log.push(
          `hopped ${from} -> ${target} to buy ${action.targetBase} (wallet ${state.wallet})`,
        );
        return true;
      }
      default:
        return false;
    }
  }

  /** A hull left ADRIFT by anything — mission, scavenge or dig — gets the real tow (rescue
   *  charges the fee and tops the tank with the emergency ration; the ship keeps every part). */
  function towIfAdrift(shipStatus: 'ON_MISSION' | 'ADRIFT', label: string): void {
    if (shipStatus !== 'ADRIFT') return;
    const tow = rescue(state, ctx.snapshot, ctx.rules, catalogByType);
    state.log.push(
      `adrift after ${label} — towed for ${tow.cost} ` +
        `(ration +${tow.rationAdded}, wallet ${state.wallet})`,
    );
  }

  while (state.missionsDone < missions) {
    currentAction = 'idle';
    if (state.clock.now() >= PLAYTIME_CAP_SECONDS) {
      endReason = 'playtime';
      state.log.push('playtime cap reached (400h of game time)');
      break;
    }
    const nowMs = baseMs + state.clock.now() * 1000;

    // Port economy before looking for work: sell what the target ship does not need, then
    // spend what the reserve-adjusted plan allows (both re-run every turn, so the sell's cash
    // is available to the buy that follows).
    currentAction = 'market';
    if (spend) {
      // Dead weight comes off first: a part the ship does not use is sold, not carried.
      for (const idleId of idleInstalledParts(state, catalogByType)) {
        const removed = unfitPart(state, ctx.rules, catalogByType, idleId);
        if (removed.ok) state.log.push(`removed idle part ${idleId} from the ship`);
      }
    }
    const prePlan = spendPlan(state, snapshot, ctx.rules, catalogByType, recentRepairBills, archetype, minerBlocked);
    if (spend) {
      const sells = sellList(state, snapshot, ctx.rules, catalogByType, prePlan.keepNeeds, archetype);
      for (const partId of sells.partIds) {
        sellPart(state, snapshot, ctx.rules, partId);
      }
      for (const material of sells.materials) {
        sellMaterial(state, snapshot, ctx.rules, material.materialId, material.quantity);
      }
    }
    // A pilot at a port does everything that is worth doing there before leaving: fits, buys and
    // upgrades chain until the plan has nothing more for this stop (or says to travel).
    let plan = spendPlan(state, snapshot, ctx.rules, catalogByType, recentRepairBills, archetype, minerBlocked);
    let travelled = false;
    for (let step = 0; spend && step < MAX_SPEND_STEPS_PER_STOP; step += 1) {
      if (process.env['SIM_DEBUG'] === '1') {
        const action = plan.action;
        const detail =
          action.kind === 'none'
            ? action.reason
            : action.kind === 'fit'
              ? `${action.targetBase} ${action.reason}`
              : action.kind === 'buy'
                ? `${action.partType}@${action.locationId} ${action.price} ${action.reason}`
                : action.kind === 'travel-to-buy'
                  ? `${action.targetBase}->${action.locationId} ${action.reason}`
                  : `${action.partId} ${action.nextPartType} ${action.reason}`;
        process.stderr.write(
          `[plan] @${state.locationId} wallet=${state.wallet} ${action.kind} ${detail}\n`,
        );
      }
      if (plan.action.kind === 'none') break;
      if (executeSpend(plan.action, nowMs)) {
        travelled = true;
        break;
      }
      const next = spendPlan(state, snapshot, ctx.rules, catalogByType, recentRepairBills, archetype, minerBlocked);
      // The same action again means it did not take (a refused fit): stop rather than spin.
      if (JSON.stringify(next.action) === JSON.stringify(plan.action)) break;
      plan = next;
    }
    if (travelled) continue;

    const picked = pickOffer(state, ctx, world, board, rng, nowMs, temperament, playstyle, memory);
    const { offer, offers } = picked;
    if (picked.fallback) {
      state.log.push(
        `fallback: ${playstyle} found nothing takeable — flew ${offer?.type ?? 'any'}`,
      );
    }

    if (offer === null) {
      emptyRounds += 1;
      minerBlocked = offers.some((entry) => {
        const take = canTakeMission(state, entry, ctx);
        return !take.ok && take.reasons.includes('MINER');
      });
      if (process.env['SIM_DEBUG'] === '1') {
        const parts = state.ship.parts
          .map((p) => catalogByType.get(p.partType)?.partClass ?? '?')
          .join(',');
        process.stderr.write(
          `[stall] @${state.locationId} fuel=${state.ship.fuel} wallet=${state.wallet} ` +
            `parts=[${parts}] offers=${offers.length} reasons=${diagnoseBoard(offers, state, ctx)}\n`,
        );
      }
      // Nothing takeable: the pilot's own two feet still work. A search on foot costs no fuel
      // and risks no hull, and what it finds (parts to fit, scrap to sell) can unblock the ship.
      {
        const nowFootMs = baseMs + state.clock.now() * 1000;
        if (spend && scavengeCooldownLeft(state, ctx.rules, nowFootMs) === 0) {
          currentAction = 'scavenge';
          const walk = scavenge(state, ctx, world, nowFootMs, true);
          if (walk.ok) {
            state.log.push(
              `scavenged on foot ${state.locationId} (nothing takeable): +${walk.partsFound} parts ` +
                `+${walk.scrapFound} scrap in ${walk.durationSeconds}s (wallet ${state.wallet})`,
            );
            continue;
          }
        }
      }
      // A rescue that buys nothing is a money pit. The pilot will pay for a few tows — a stranded
      // ship has no other way home — but once they stop yielding takeable work the run is over,
      // and the stall must be reported rather than the wallet drained on a loop.
      if (rescuesTaken >= RESCUE_MAX_ATTEMPTS || emptyRounds > MAX_EMPTY_ROUNDS) {
        stalled = true;
        stallReason =
          `nothing takeable for ${emptyRounds} board turns @ ${state.locationId}` +
          `: ${diagnoseBoard(offers, state, ctx)}`;
        endReason = 'board-stall';
        state.log.push(stallReason);
        break;
      }
      // A viability-failed ship has no takeable offer at all, so decideRepair never runs and a
      // fuel buy-out cannot help a hull the resolver will not launch — that is the deadlock.
      // The condition-driven failure is a dead fuel holder: the sheet drops it from fuelCap and
      // the hull cannot launch. Repair *those parts* — a full overhaul costs more than a late
      // run has left, and the remaining problems are catalog setup no workshop can fix. Ordinary
      // wear is not grounds: a quiet board says nothing about the thresholds decideRepair weighs.
      const viabilityParts = installedParts(state.ship, ctx.catalogByType);
      const viability = checkViability(
        deriveSheet(viabilityParts, ctx.rules),
        viabilityParts,
        ctx.rules,
      );
      if (!viability.viable) {
        currentAction = 'repair';
        const targets = viabilityParts
          .filter(
            (part) => isDead(part.instance.condition, ctx.rules) && (part.catalog.fuelCap ?? 0) > 0,
          )
          .map((part) => ({ partId: part.instance.id }));
        const quote = repairQuote(
          state,
          snapshot,
          ctx.rules,
          catalogByType,
          state.locationId,
          targets,
        );
        if (process.env['SIM_DEBUG'] === '1') {
          process.stderr.write(
            `[ground] @${state.locationId} fuel=${state.ship.fuel} wallet=${state.wallet} ` +
              `points=${quote.points} cost=${quote.cost} empty=${emptyRounds} ` +
              `problems=${viability.problems.map((p) => p.code).join('+')}\n`,
          );
        }
        if (spend && targets.length > 0 && quote.points > 0 && quote.cost <= state.wallet) {
          const bill = repair(state, snapshot, ctx.rules, catalogByType, state.locationId, targets);
          if (bill.cost > 0) recentRepairBills.push(bill.cost);
          state.clock.advance(budget.humanPauseSeconds);
          emptyRounds = 0;
          state.log.push(`repaired ${bill.points} points to fly again (wallet ${state.wallet})`);
          continue;
        }
        state.log.push(
          `grounded at ${state.locationId}: repair ${quote.points} points costs ${quote.cost}, ` +
            `wallet ${state.wallet}`,
        );
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
      if (cheapestUnlock !== undefined && spend) {
        const shortfall = cheapestUnlock.need - state.ship.fuel;
        const quote = refuelQuote(
          state,
          snapshot,
          ctx.rules,
          catalogByType,
          state.locationId,
          shortfall,
        );
        currentAction = 'fuel';
        if (quote.cost <= state.wallet) {
          currentAction = 'fuel';
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
        if (shortfall > 0 && spend) {
          const quote = refuelQuote(
            state,
            snapshot,
            ctx.rules,
            catalogByType,
            state.locationId,
            shortfall,
          );
          if (quote.cost <= state.wallet) {
            currentAction = 'fuel';
            refuel(state, snapshot, ctx.rules, catalogByType, state.locationId, shortfall);
          }
        }
        if (state.ship.fuel >= need) {
          const from = state.locationId;
          currentAction = 'travel';
          const trip = travel(state, ctx, world, hop.destinationId, nowMs);
          if (trip === null) {
            // The pilot cannot actually leave (power, requirements, viability): count the turn
            // and say why — a fake success here would hop forever without moving and reset the
            // stall detector every round.
            const check = canTakeMission(state, hop, ctx);
            state.log.push(
              `cannot hop ${from} -> ${hop.destinationId}: ` +
                `${check.reasons.join(',') || 'refused'}`,
            );
          } else {
            state.missionsDone -= 1;
            state.clock.advance(budget.humanPauseSeconds);
            state.log.push(
              `hopped ${from} -> ${trip.destinationId} for work (wallet ${state.wallet})`,
            );
            emptyRounds = 0;
            continue;
          }
        }
      }
      // A rescue is how a stranded pilot gets back to safety: a tow to the nearest base, at the
      // game's price, with an emergency ration when the tank is dry. The ship keeps every part —
      // the tow buys a way home, not a new build. It fires only when the pilot cannot reach any
      // other port, or has bought their way as far as they can and still has no work.
      const dry = state.ship.fuel < rescueRationOf(state, ctx);
      if (
        spend &&
        (!canReachAnywhereSafe(state, ctx, world, nowMs) ||
          (emptyRounds >= RESCUE_AFTER_EMPTY_ROUNDS && dry))
      ) {
        currentAction = 'rescue';
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
    // A bill the wallet cannot cover is deferred, not thrown: the pilot earns it next mission —
    // unless the hull cannot fly at all, in which case the board stays empty and the stall says so.
    const repairDecision = spend ? decideRepair(state, snapshot, ctx.rules, catalogByType) : null;
    currentAction = 'repair';
    if (repairDecision !== null && repairDecision.shouldRepair) {
      const quote = repairQuote(state, snapshot, ctx.rules, catalogByType, state.locationId);
      // Keep what a full tank here costs: a repaired ship with no fuel goes nowhere.
      const tankCost = refuelQuote(state, snapshot, ctx.rules, catalogByType, state.locationId).cost;
      if (quote.cost > state.wallet - tankCost) {
        // Not enough for the whole ship and a tank: repair the most worn parts the rest covers.
        const targets = affordableRepairTargets(
          state,
          snapshot,
          ctx.rules,
          catalogByType,
          Math.max(0, state.wallet - tankCost),
        );
        if (targets === null) {
          state.log.push(
            `repair deferred at ${state.locationId}: costs ${quote.cost}, wallet ${state.wallet}`,
          );
        } else {
          const bill = repair(state, snapshot, ctx.rules, catalogByType, state.locationId, targets);
          if (bill.cost > 0) recentRepairBills.push(bill.cost);
          state.clock.advance(budget.humanPauseSeconds);
          state.log.push(
            `partial repair at ${state.locationId}: ${bill.points} points for ${bill.cost} ` +
              `(whole ship ${quote.cost}, wallet ${state.wallet})`,
          );
        }
      } else {
        const bill = repair(state, snapshot, ctx.rules, catalogByType, state.locationId);
        if (bill.cost > 0) recentRepairBills.push(bill.cost);
        state.clock.advance(budget.humanPauseSeconds);
      }
    } else if (repairDecision?.reason === 'travel-to-cheap-repair') {
      const target = cheapestReachablePort(state, snapshot, ctx.rules, catalogByType);
      if (target !== null && canTravelTo(state, ctx, world, target, nowMs)) {
        currentAction = 'travel';
        const trip = travel(state, ctx, world, target, nowMs);
        if (trip !== null) {
          state.missionsDone -= 1;
          state.clock.advance(budget.humanPauseSeconds);
          currentAction = 'repair';
          // The trip can end short of the port (a lost fight, a dry tank): repair only where the
          // ship actually is.
          if (state.locationId === target) {
            const quote = repairQuote(state, snapshot, ctx.rules, catalogByType, target);
            if (quote.cost <= state.wallet) {
              const bill = repair(state, snapshot, ctx.rules, catalogByType, target);
              if (bill.cost > 0) recentRepairBills.push(bill.cost);
            }
          }
          continue;
        }
        // The trip was refused: stay put and fly what the board here offers instead of
        // pretending to be at the cheaper port.
      }
    }

    // Before flying: decide whether to refuel, and how much (the plan's exact rule). The offer
    // was already taken as-is — its fuel fits the tank — so a top-up the wallet cannot pay for
    // is skipped; only the mission's own fuel is mandatory, and pickOffer guaranteed that.
    const fuelDecision = decideFuel(state, snapshot, ctx.rules, catalogByType, offer);
    currentAction = 'fuel';
    if (fuelDecision.shouldRefuel) {
      const quote = refuelQuote(
        state,
        snapshot,
        ctx.rules,
        catalogByType,
        state.locationId,
        fuelDecision.units,
      );
      if (quote.cost > state.wallet) {
        state.log.push(
          `refuel skipped at ${state.locationId}: ${quote.units} units cost ${quote.cost}, ` +
            `wallet ${state.wallet}`,
        );
      } else {
        refuel(state, snapshot, ctx.rules, catalogByType, state.locationId, fuelDecision.units);
        state.clock.advance(budget.humanPauseSeconds);
      }
    }

    currentAction = 'mission';
    const result = takeMission(state, offer, ctx);
    state.clock.advance(budget.humanPauseSeconds);
    towIfAdrift(result.shipStatus, result.type);
    records.push(recordOutcome(state, ctx, budget, result));
    memory.wearSamples.push({
      distance: result.distance,
      danger: result.maxDanger,
      wearPoints: result.wearPoints,
    });
    if (memory.wearSamples.length > WEAR_SAMPLE_WINDOW) memory.wearSamples.shift();
    if (result.shipStatus === 'ADRIFT') {
      memory.stranded.set(tripKey(offer), fuelCapOfShip(state, ctx));
    }

    // --- Opportunistic jobs between missions (Phase 3). ---
    const afterMs = baseMs + state.clock.now() * 1000;
    // Scavenge on at least 75% of missions when the cooldown and the danger rule allow it.
    const scavengeJob = scavengeOffer({ snapshot, world, state, nowMs: afterMs });
    if (scavengeJob !== null && scavengeCooldownLeft(state, ctx.rules, afterMs) === 0) {
      // With the ship when the ship can take the job and the danger rule allows it; on foot
      // (no pirates, no wear, half the finds) when the ship may not, or is too worn to risk
      // with no money to repair it — the safe way to keep earning parts while broke.
      const shipOk =
        canTakeMission(state, scavengeJob, ctx).ok && decideDanger(state, catalogByType, scavengeJob).accept;
      const tooWorn =
        needsRepair(state, catalogByType) &&
        state.wallet < repairQuote(state, snapshot, ctx.rules, catalogByType, state.locationId).cost;
      const onFoot = !shipOk || tooWorn;
      if (atOrBelowTarget(scavengeFlags, SCAVENGE_RATIO_MIN)) {
        currentAction = 'scavenge';
        const job = scavenge(state, ctx, world, afterMs, onFoot);
        if (job.ok) {
          scavengeFlags.push(true);
          if (!onFoot) towIfAdrift(job.shipStatus, 'scavenge');
          state.log.push(
            `scavenged${onFoot ? ' on foot' : ''} ${state.locationId}: +${job.partsFound} parts ` +
              `+${job.scrapFound} scrap in ${job.durationSeconds}s (wallet ${state.wallet})`,
          );
        }
      } else {
        scavengeFlags.push(false);
      }
      if (scavengeFlags.length > RATIO_WINDOW) scavengeFlags.shift();
    }
    // Mine on at least 50% of missions where a rig and a minable place line up.
    const mineGate = canMine(state, ctx, world);
    const mineJob = mineGate.ok ? miningOffer({ snapshot, world, state, nowMs: afterMs }) : null;
    if (
      playstyleAllowsJob(playstyle, 'mining') &&
      mineJob !== null &&
      canTakeMission(state, mineJob, ctx).ok &&
      decideDanger(state, catalogByType, mineJob).accept
    ) {
      if (atOrBelowTarget(mineFlags, MINE_RATIO_MIN)) {
        currentAction = 'mining';
        const job = mine(state, ctx, world, afterMs);
        if (job.ok) {
          mineFlags.push(true);
          towIfAdrift(job.shipStatus, 'mining');
          state.log.push(
            `mined ${state.locationId}: ${job.materialId} (${job.status}) ` +
              `in ${job.durationSeconds}s (wallet ${state.wallet})`,
          );
        }
      } else {
        mineFlags.push(false);
      }
      if (mineFlags.length > RATIO_WINDOW) mineFlags.shift();
    }

    // The run's level is the lowest rarity on the hull; record each step up after the phases
    // (a free fit can raise it too), then watch the two exhaustion ends: no progress for
    // `PROGRESS_STALL_MISSIONS` missions with a flat wallet, or the top of the ladder.
    const levelNow = shipLevel(state.ship, catalogByType);
    if (levelNow > lastLevel) {
      lastLevel = levelNow;
      levels.push(levelRecord(state, catalogByType, budget));
      levelChangeAt = state.missionsDone;
    }
    walletTrail.push({ mission: state.missionsDone, wallet: state.wallet });
    const windowStart = walletTrail.find(
      (entry) => entry.mission <= state.missionsDone - PROGRESS_STALL_MISSIONS,
    );
    if (
      state.missionsDone - levelChangeAt >= PROGRESS_STALL_MISSIONS &&
      windowStart !== undefined &&
      state.wallet <= windowStart.wallet
    ) {
      stalled = true;
      stallReason =
        `no level change and no wallet growth across ${PROGRESS_STALL_MISSIONS} missions ` +
        `@ ${state.locationId}`;
      endReason = 'progress-stall';
      state.log.push(stallReason);
      break;
    }
    if (lastLevel >= MAX_SHIP_LEVEL) {
      endReason = 'ship-level';
      state.log.push('target ship reached level 5');
      break;
    }
  }

  if (process.env['SIM_DEBUG'] === '1') {
    const kit = state.ship.parts
      .map(
        (part) =>
          `${part.partType}:${catalogByType.get(part.partType)?.rarity ?? '?'}@${part.condition}`,
      )
      .join(' ');
    process.stderr.write(
      `[final] level=${shipLevel(state.ship, catalogByType)} wallet=${state.wallet} parts=${kit}\n`,
    );
  }
  const successes = records.filter(
    (record) => record.status === 'success' || record.status === 'partial_failure',
  ).length;
  return {
    seed,
    factionId,
    temperament,
    playstyle,
    archetype,
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
    endReason,
    scavengesDone: state.scavengesDone,
    miningDone: state.miningDone,
    footScavenges: state.footScavenges,
    findsValue: state.findsFittedValue,
    repairActions: state.repairActions,
    finalParts: state.ship.parts.map((part) => `${part.partType}@${Math.round(part.condition)}`),
    levels,
    missions: records,
    log: state.log,
    actionSeconds,
  };
}

/**
 * The faction of a run with none given: rotates through the playable ones by seed, since a real
 * pilot picks any of them and the three start in different places with different boards.
 */
export function factionForSeed(snapshot: Snapshot, seed: number): string {
  const homeOf = snapshot.rules.onboarding.home_locations as unknown as Record<string, string>;
  const placed = new Set(snapshot.locations.map((row) => row.id));
  const all = Object.keys(homeOf);
  // Only factions that can start somewhere the snapshot has (an edited or trimmed world).
  const homes = all.filter((faction) => placed.has(homeOf[faction] ?? ''));
  const pool = homes.length > 0 ? homes : all;
  if (pool.length === 0) throw new Error('rules.onboarding.home_locations is empty');
  return pool[Math.abs(seed - 1) % pool.length]!;
}

/** The playable faction the sim defaults to (the first home in the onboarding map). */
export function defaultFaction(snapshot: Snapshot): string {
  const homes = snapshot.rules.onboarding.home_locations as unknown as Record<string, string>;
  const first = Object.keys(homes)[0];
  if (first === undefined) throw new Error('rules.onboarding.home_locations is empty');
  return first;
}
