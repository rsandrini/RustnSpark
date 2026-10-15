/**
 * Scavenging as a timed job, built exactly like `missions/scavenge-job.service.ts → start`: a
 * SCAVENGE mission at the ship's own port, dispatched through the same resolver, that starts and
 * ends where it stood and pays nothing — its finds (used parts, some scrap) come out of the seeded
 * resolver. The per-location attempt counter carries the 600s cooldown, and the leg uses the same
 * duration trick the live service uses (`distance` sized so this ship flies it in exactly
 * `scavenging.duration_seconds`), with fuel × 0 because the ship never leaves.
 *
 * A job is not a mission on the run's tally: `takeMission` increments `missionsDone` like it does
 * for any mission instance, and this action puts it straight back, so the bot's `--missions`
 * budget and its scavenge-ratio window count real contract work only.
 */
import type { GameRules } from '../../src/config/game-config.types.js';
import { legForRoute } from '../../src/missions/generator/template.filler.js';
import type { FillerWorld } from '../../src/missions/generator/template.filler.js';
import { deriveSheet } from '../../src/ships/sheet.deriver.js';
import { catalogIndex, installedParts, type PlayerState } from '../core/state.js';
import type { Snapshot } from '../snapshot/types.js';
import type { Offer } from '../core/world.js';
import { canTakeMission, takeMission, type MissionContext } from './mission.js';

export const SCAVENGE_TEMPLATE_ID = 'scavenge_generic';
/** The sim's player id inside job seeds (the game uses its Prisma player id). */
const SIM_PLAYER_ID = 'sim';
/** The offer window only outlives the call, like the live mission's one-hour expiry. */
const JOB_OFFER_TTL_MS = 3_600_000;
/** A search around the port burns no fuel: the ship never leaves it. */
const SCAVENGE_FUEL_MULT = 0;
const MS_PER_SECOND = 1000;

/** Seconds left on the current port's cooldown (0 when the next attempt is allowed now). */
export function scavengeCooldownLeft(
  state: PlayerState,
  rules: GameRules,
  nowMs: number,
): number {
  const entry = state.scavengeAttempts.get(state.locationId);
  if (entry === undefined || entry.count === 0) return 0;
  const elapsed = Math.floor((nowMs - entry.lastAtMs) / MS_PER_SECOND);
  return Math.max(0, rules.scavenging.cooldown_seconds - elapsed);
}

export interface JobOfferInput {
  readonly snapshot: Snapshot;
  readonly world: FillerWorld;
  readonly state: PlayerState;
  readonly nowMs: number;
  /** Search on foot (`foot_duration_seconds`, no ship in the job). */
  readonly onFoot?: boolean;
}

/**
 * The SCAVENGE offer for the ship's current port, or null when the place has no route at all
 * (`NO_ROUTE` in the live service — the leg needs one to borrow its danger from).
 */
export function scavengeOffer(input: JobOfferInput): Offer | null {
  const { snapshot, world, state, nowMs } = input;
  const onFoot = input.onFoot === true;
  const locationId = state.locationId;
  const location = snapshot.locations.find((row) => row.id === locationId);
  if (location === undefined) return null;
  // The place's risk is the danger of the routes around it: the same number encounters use.
  const routes = snapshot.routes
    .filter((route) => route.nodeAId === locationId || route.nodeBId === locationId)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const route = routes[0];
  if (route === undefined) return null;
  const danger = routes.reduce((peak, entry) => Math.max(peak, entry.danger), 0);
  // A distance that makes the flight last `duration_seconds` for THIS ship (mission time).
  const sheet = deriveSheet(installedParts(state.ship, catalogIndex(snapshot)), snapshot.rules);
  const distance = Math.max(
    1,
    Math.round(
      ((onFoot
        ? snapshot.rules.scavenging.foot_duration_seconds
        : snapshot.rules.scavenging.duration_seconds) /
        (snapshot.rules.missions.duration_k * snapshot.rules.missions.time_scale)) *
        sheet.mob,
    ),
  );
  const locationsById = new Map(world.locations.map((entry) => [entry.id, entry]));
  const base = legForRoute(route, locationsById, world);
  const leg = {
    routeId: base.routeId ?? route.id,
    distance,
    danger,
    zone: location.zone,
    env: { ...base.env, fuelMult: SCAVENGE_FUEL_MULT },
  };
  const attempt = state.scavengeAttempts.get(locationId)?.count ?? 0;
  const seed = `scavenge|${SIM_PLAYER_ID}|${locationId}|${attempt}|${nowMs}`;
  const template = snapshot.templates.find((row) => row.id === SCAVENGE_TEMPLATE_ID);
  return {
    id: seed,
    seed,
    templateId: SCAVENGE_TEMPLATE_ID,
    type: 'SCAVENGE',
    factionId: state.factionId,
    originId: locationId,
    destinationId: locationId,
    legs: [leg],
    cargo: {},
    reward: 0,
    expiresAtMs: nowMs + JOB_OFFER_TTL_MS,
    deadlineAtMs: null,
    starter: false,
    requirements: template?.requirements ?? {},
    encounterPolicy: template?.encounterPolicy ?? {},
  };
}

export type ScavengeOutcome =
  | {
      readonly ok: true;
      readonly durationSeconds: number;
      readonly scrapFound: number;
      readonly partsFound: number;
      /** A job that comes back adrift still needs the real tow (the bot pays it). */
      readonly shipStatus: 'ON_MISSION' | 'ADRIFT';
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Run one scavenge job at the ship's current port. Refuses while the per-location cooldown is
 * still running (`SCAVENGE_COOL_DOWN`); on success the attempt counter advances exactly like the
 * live service updates `ScavengeCounter` after dispatch. The caller (bot loop) still pays the
 * rescue tow when the job comes back adrift.
 */
export function scavenge(
  state: PlayerState,
  ctx: MissionContext,
  world: FillerWorld,
  nowMs: number,
  onFoot = false,
): ScavengeOutcome {
  const cooldown = scavengeCooldownLeft(state, ctx.rules, nowMs);
  if (cooldown > 0) return { ok: false, reason: `SCAVENGE_COOL_DOWN:${cooldown}` };
  const offer = scavengeOffer({ snapshot: ctx.snapshot, world, state, nowMs, onFoot });
  if (offer === null) return { ok: false, reason: 'NO_ROUTE' };
  if (!onFoot) {
    const check = canTakeMission(state, offer, ctx);
    if (!check.ok) return { ok: false, reason: check.reasons.join(',') };
  }
  const result = takeMission(state, offer, ctx, { onFoot });
  // A job is not a mission on the run's tally (see the file header).
  state.missionsDone -= 1;
  if (onFoot) state.footScavenges += 1;
  const locationId = state.locationId;
  const entry = state.scavengeAttempts.get(locationId);
  state.scavengeAttempts.set(locationId, {
    count: (entry?.count ?? 0) + 1,
    lastAtMs: nowMs,
  });
  return {
    ok: true,
    durationSeconds: result.durationSeconds,
    scrapFound: result.scrapFound,
    partsFound: result.partsFound,
    shipStatus: result.shipStatus,
  };
}
