/**
 * One mission, end to end: the same accept + dispatch + resolve pipeline the game runs, over the
 * sim's in-memory player. Nothing here invents math — requirements come from
 * `checkMissionRequirements`, the payout from the resolver (finalized at accept from the ship's
 * tier, like `missions.service.ts → accept`), the duration from `missionDuration`, and the
 * outcome from the real `resolveMission(buildResolveInput(...))`.
 */
import type { GameRules } from '../../src/config/game-config.types.js';
import { fuelUnits } from '../../src/economy/fuel-cost.calculator.js';
import type { DispatchLeg, DispatchSnapshot } from '../../src/missions/dispatch.service.js';
import { missionDuration } from '../../src/missions/duration.calculator.js';
import { missionReward } from '../../src/missions/mission.reward.js';
import { buildResolveInput, contextFromLive } from '../../src/missions/resolution-input.js';
import { checkMissionRequirements } from '../../src/missions/requirements.checker.js';
import { isDead } from '../../src/parts/condition.js';
import { allocatePower, powerPartOf } from '../../src/resolution/power/power.js';
import { resolveMission } from '../../src/resolution/mission/mission.resolver.js';
import { deriveSheet } from '../../src/ships/sheet.deriver.js';
import { shipTier } from '../../src/ships/ship-tier.js';
import { checkViability } from '../../src/ships/viability.js';
import type { CatalogRow, MissionTypeName, Snapshot } from '../snapshot/types.js';
import {
  catalogIndex,
  catalogStatsOf,
  installedParts,
  wearPoints,
  type PlayerState,
  type ShipPartState,
} from '../core/state.js';
import { scavengeContextOf, type Offer } from '../core/world.js';
import {
  bridgeRarityIndex,
  NO_SCALING,
  rewardMultiplier,
  scaleOffer,
  type BridgeScaling,
} from '../experiment/scaling.js';
import { SCRAP_MATERIAL_ID } from '../../src/economy/scrap.js';

export interface MissionContext {
  readonly snapshot: Snapshot;
  readonly rules: GameRules;
  readonly catalogByType: ReadonlyMap<string, CatalogRow>;
  /** The what-if table (Phase 5): when present, rewards and numeric requirements scale. */
  readonly bridgeScaling?: BridgeScaling;
}

export function missionContext(snapshot: Snapshot, bridgeScaling?: BridgeScaling): MissionContext {
  return {
    snapshot,
    rules: snapshot.rules,
    catalogByType: catalogIndex(snapshot),
    ...(bridgeScaling === undefined ? {} : { bridgeScaling }),
  };
}

export interface TakeCheck {
  readonly ok: boolean;
  /** Requirement codes and ship-side blockers, for the log and the report. */
  readonly reasons: readonly string[];
}

export function totalFuelNeeded(legs: readonly DispatchLeg[], fuelUse: number): number {
  return legs.reduce(
    (sum, leg) =>
      sum + fuelUnits({ fuelUse, distance: leg.distance, envFuelMult: leg.env.fuelMult }),
    0,
  );
}

/** Can this ship accept this offer right now? Mirrors `missions.service.ts → accept`'s checks. */
export function canTakeMission(state: PlayerState, offer: Offer, ctx: MissionContext): TakeCheck {
  const reasons: string[] = [];
  if (state.locationId !== offer.originId) reasons.push('SHIP_NOT_AT_ORIGIN');
  const installed = installedParts(state.ship, ctx.catalogByType);
  const sheet = deriveSheet(installed, ctx.rules);
  const viability = checkViability(sheet, installed, ctx.rules);
  // Scavenging is manual work at the current place, not a trip flown with the ship: the live
  // dispatch skips the viability and power gates for it too (`dispatch.service.ts`), marking
  // the job handicapped instead (the resolver then halves its find chance).
  const isScavengeJob = offer.type === 'SCAVENGE';
  if (!isScavengeJob && !viability.viable) reasons.push('SHIP_NOT_VIABLE');
  // The what-if hook: a bridge's rarity can scale the numeric requirements (and the reward,
  // at take time) — the game does not do this yet, so it only fires when a table is set.
  const scaling = ctx.bridgeScaling ?? NO_SCALING;
  const scaled = scaleOffer(offer, scaling, bridgeRarityIndex(state, ctx.catalogByType));
  const requirement = checkMissionRequirements(
    { missionType: offer.type, requirements: scaled.requirements, sheet, parts: installed },
    ctx.rules,
  );
  if (!requirement.eligible) reasons.push(...requirement.reasons.map((reason) => reason.code));
  const fuelNeeded = totalFuelNeeded(offer.legs, sheet.fuelUse);
  if (fuelNeeded > state.ship.fuel) reasons.push('NOT_ENOUGH_FUEL');
  // Power must be allocatable at cruise (the plan's post-change check, before anything flies).
  const power = installed.map((part) =>
    powerPartOf(part.instance.id, part.catalog, ctx.rules.power.idle_demand),
  );
  const cruise = allocatePower(power, 'cruise', ctx.rules);
  if (!isScavengeJob && cruise.demand > cruise.supply) reasons.push('POWER_SHORTFALL');
  return { ok: reasons.length === 0, reasons };
}

export interface MissionRunResult {
  readonly offerId: string;
  readonly type: MissionTypeName;
  readonly templateId: string;
  readonly originId: string;
  readonly destinationId: string;
  readonly distance: number;
  readonly maxDanger: number;
  readonly zone: number;
  /** The accept-time figure (`missionReward` at this ship's tier). */
  readonly rewardOffered: number;
  /** What the resolver actually paid (payment events, after integrity). */
  readonly rewardPaid: number;
  readonly status: string;
  readonly shipStatus: 'ON_MISSION' | 'ADRIFT';
  readonly integrity: number;
  readonly durationSeconds: number;
  readonly fuelBurned: number;
  readonly wearPoints: number;
  readonly fights: number;
  readonly wins: number;
  readonly losses: number;
  readonly scrapFound: number;
  readonly partsFound: number;
  readonly creditEvents: { readonly reward: number; readonly combat: number };
}

/** Mirrors `keepsLootAdrift` in `missions/resolve.service.ts` (an unpaid mining job keeps its ore). */
function keepsLootAdrift(offer: Offer): boolean {
  return offer.type === 'MINING' && offer.reward <= 0;
}

function employerRelationsOf(snapshot: Snapshot, factionId: string): unknown {
  return snapshot.factions.find((faction) => faction.id === factionId)?.relations ?? {};
}

function materialRarityOf(snapshot: Snapshot, cargo: Record<string, unknown>): string | undefined {
  const materialId = cargo['materialId'];
  if (typeof materialId !== 'string') return undefined;
  const row = snapshot.materials.find((material) => material.id === materialId);
  return row?.rarity.toLowerCase() ?? 'common';
}

/** Accept, fly and resolve one offer, applying the outcome to the player exactly like the game. */
export function takeMission(
  state: PlayerState,
  offer: Offer,
  ctx: MissionContext,
): MissionRunResult {
  const { snapshot, rules, catalogByType } = ctx;
  const check = canTakeMission(state, offer, ctx);
  if (!check.ok) {
    throw new Error(`cannot take ${offer.id}: ${check.reasons.join(', ')}`);
  }

  const partsBefore: ShipPartState[] = state.ship.parts.map((part) => ({ ...part }));
  const installed = installedParts(state.ship, catalogByType);
  const sheet = deriveSheet(installed, rules);

  // D29: accept finalizes the reward from this ship's tier; resolution pays from the same tier.
  const tier = shipTier(
    installed.map((part) => ({ basePrice: part.catalog.basePrice })),
    rules,
  );
  // Board offers carry a provisional figure that accept re-prices (D29). The player's own jobs
  // (scavenge, free mining) are created already-ACCEPTED with reward 0 — exactly what the two
  // job services store — so they stay unpaid and the resolver takes its `unpaid` path: no
  // payout line, no minimum yield, the finds/ore are the whole result.
  const rewardOffered =
    offer.reward === 0
      ? 0
      : missionReward(
          {
            legs: offer.legs as unknown as Parameters<typeof missionReward>[0]['legs'],
            type: offer.type,
          },
          tier,
          rules,
        );
  // The what-if hook, pay side: the bridge's rarity multiplies the accept-time figure, and the
  // resolver is paid from it — all ones is today's game.
  const rewardMult = rewardMultiplier(
    ctx.bridgeScaling ?? NO_SCALING,
    bridgeRarityIndex(state, catalogByType),
  );
  const scaledReward = Math.round(rewardOffered * rewardMult);

  const legs: DispatchLeg[] = offer.legs.map((leg) => ({
    routeId: leg.routeId,
    distance: leg.distance,
    danger: leg.danger,
    zone: leg.zone,
    env: leg.env,
  }));
  const totalDistance = legs.reduce((sum, leg) => sum + leg.distance, 0);
  const { durationSeconds } = missionDuration({
    totalDistance,
    mobility: sheet.mob,
    durationK: rules.missions.duration_k,
    timeScale: rules.missions.time_scale,
    classCutoffs: rules.missions.duration_class_cutoffs,
  });

  const cargo = offer.cargo as Record<string, unknown>;
  const destination = snapshot.locations.find((row) => row.id === offer.destinationId);
  if (destination === undefined) {
    throw new Error(`destination ${offer.destinationId} is not in the snapshot`);
  }

  const dispatch: DispatchSnapshot = {
    shipId: state.ship.id,
    fuel: state.ship.fuel,
    currentLocationId: state.locationId,
    stance: state.ship.stance,
    energyMode: state.ship.energyMode,
    parts: state.ship.parts.map((part) => {
      const row = catalogByType.get(part.partType);
      if (row === undefined) {
        throw new Error(`part type ${part.partType} is not in the snapshot catalog`);
      }
      return {
        id: part.id,
        partType: part.partType,
        condition: part.condition,
        catalog: catalogStatsOf(row),
        connected: true,
      };
    }),
    legs,
    storage: state.storage.map((part) => ({ id: part.id, partType: part.partType })),
    layered: true,
  };

  const context = contextFromLive({
    type: offer.type,
    cargo: offer.cargo,
    encounterPolicy: offer.encounterPolicy,
    employerRelations: employerRelationsOf(snapshot, offer.factionId),
    playerFactionId: state.factionId,
    destinationIsolation: destination.isolation,
    materialRarity: materialRarityOf(snapshot, cargo),
    reward: scaledReward,
    scavenge:
      offer.type === 'SCAVENGE'
        ? {
            ...scavengeContextOf(snapshot, offer.originId),
            // A ship that cannot fly still scavenges, at `scavenging.handicap_factor` of the
            // finds — the same flag dispatch sets when it dispatches a non-viable hull.
            handicapped: !checkViability(sheet, installed, rules).viable,
          }
        : null,
  });

  const outcome = resolveMission(
    buildResolveInput({
      missionId: offer.id,
      missionType: offer.type,
      seed: offer.seed,
      snapshot: dispatch,
      context,
      rules,
    }),
  );

  // --- Apply the outcome, same persistence rules as `missions/resolve.service.ts`. ---
  const conditionById = new Map(outcome.parts.map((part) => [part.id, Math.round(part.condition)]));
  state.ship.parts = partsBefore.map((part) => ({
    ...part,
    condition: conditionById.get(part.id) ?? part.condition,
  }));

  const fuelCapAfter = state.ship.parts
    .filter((part) => !isDead(part.condition, rules))
    .reduce((sum, part) => sum + (catalogByType.get(part.partType)?.fuelCap ?? 0), 0);
  const fuelAfter = Math.min(Math.max(0, outcome.fuel), fuelCapAfter);
  const fuelBurned = Math.max(0, dispatch.fuel - fuelAfter);
  state.ship.fuel = fuelAfter;

  const adrift = outcome.shipStatus === 'ADRIFT';
  const keepLoot = !adrift || keepsLootAdrift(offer);

  // Pirates took what was in the hold (frozen ids, chosen by the seeded engine).
  const stolenIds = new Set(outcome.events.flatMap((event) => event.stolen ?? []));
  if (stolenIds.size > 0) {
    state.storage = state.storage.filter((part) => !stolenIds.has(part.id));
  }

  // Scavenge finds: parts land in the hold, scrap becomes a fixed-price material.
  let scrapFound = 0;
  let partsFound = 0;
  for (const event of outcome.events) {
    if (event.type !== 'scavenge_find' || event.found === undefined) continue;
    const found = event.found;
    if (found.kind === 'part') {
      partsFound += 1;
      state.partSeq += 1;
      state.storage.push({
        id: `scavenged-${state.partSeq}`,
        partType: found.partType,
        condition: found.condition,
        source: 'scavenge',
      });
    } else {
      scrapFound += 1;
      // Scrap is one generic material whichever part it was found of (economy/scrap.ts).
      state.materials.set(SCRAP_MATERIAL_ID, (state.materials.get(SCRAP_MATERIAL_ID) ?? 0) + 1);
    }
  }

  if (keepLoot) {
    for (const entry of outcome.loot) {
      if (entry.quantity <= 0) continue;
      state.materials.set(
        entry.materialId,
        (state.materials.get(entry.materialId) ?? 0) + entry.quantity,
      );
    }
  }

  // Credits: the wallet takes the resolver's net; the ledger splits payment from combat spoils.
  let paid = 0;
  let combat = 0;
  for (const event of outcome.events) {
    const credits = event.effects.credits;
    if (credits === 0) continue;
    if (event.category === 'payment') paid += credits;
    else if (event.category === 'combat') combat += credits;
  }
  const credited = Math.round(outcome.creditsDelta);
  state.wallet += credited;
  state.ledger.record('reward', Math.round(paid));
  state.ledger.record('combat', Math.round(combat));

  // A ship that came back docks at the destination; one adrift stays where it started, still
  // floating — the caller (the bot loop) pays the real rescue tow to bring it back to a base.
  const done = outcome.status === 'success' || outcome.status === 'partial_failure';
  if (done && !adrift) {
    state.locationId = offer.destinationId;
  }

  state.missionsDone += 1;
  if (offer.type === 'SCAVENGE') {
    state.scavengesDone += 1;
    state.lastScavengeAt = state.clock.now();
  }
  if (offer.type === 'MINING') state.miningDone += 1;

  state.clock.advance(durationSeconds);

  const wins = outcome.events.filter((event) => event.type === 'combat_win').length;
  const losses = outcome.events.filter((event) => event.type === 'combat_loss').length;

  return {
    offerId: offer.id,
    type: offer.type,
    templateId: offer.templateId,
    originId: offer.originId,
    destinationId: offer.destinationId,
    distance: totalDistance,
    maxDanger: legs.reduce((peak, leg) => Math.max(peak, leg.danger), 0),
    zone: legs.reduce((peak, leg) => Math.max(peak, leg.zone), 0),
    rewardOffered: scaledReward,
    rewardPaid: Math.round(paid),
    status: outcome.status,
    shipStatus: outcome.shipStatus,
    integrity: outcome.integrity,
    durationSeconds,
    fuelBurned,
    wearPoints: wearPoints(partsBefore, state.ship.parts),
    fights: wins + losses,
    wins,
    losses,
    scrapFound,
    partsFound,
    creditEvents: { reward: Math.round(paid), combat: Math.round(combat) },
  };
}
