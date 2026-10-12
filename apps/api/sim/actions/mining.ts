/**
 * Independent mining as a timed job, built exactly like `missions/mining-job.service.ts → start`:
 * a free (uncontracted) MINING mission at the ship's own location that starts and ends where it
 * stood and pays nothing — its yield is whatever the dig turns up, resolved by the real resolver
 * from the seeded material pick. Two gates the live service applies itself (and the board's
 * requirement checker never saw): the location must be minable at all, and the ship must carry a
 * mining rig (`NO_MINING_RIG`). Like scavenging, the job does not count as a mission on the run's
 * tally — `mine` undoes `takeMission`'s increment before returning.
 */
import type { FillerWorld } from '../../src/missions/generator/template.filler.js';
import { isMiningEligible, legForRoute } from '../../src/missions/generator/template.filler.js';
import { createRng } from '../core/rng.js';
import { catalogIndex, installedParts, type PlayerState } from '../core/state.js';
import type { Snapshot } from '../snapshot/types.js';
import type { Offer } from '../core/world.js';
import { canTakeMission, takeMission, type MissionContext } from './mission.js';
import { checkViability } from '../../src/ships/viability.js';
import { deriveSheet } from '../../src/ships/sheet.deriver.js';

export const MINING_JOB_TEMPLATE_ID = 'mining_job_generic';
/** The sim's player id inside job seeds (the game uses its Prisma player id). */
const SIM_PLAYER_ID = 'sim';
const JOB_OFFER_TTL_MS = 3_600_000;
/** A dig around the ship's own location burns no fuel: it never leaves. */
const MINING_FUEL_MULT = 0;

/** Ores only: scrap has a fixed price and is found by scavenging, not dug up. */
function oresOf(snapshot: Snapshot): { id: string }[] {
  return snapshot.materials.filter((row) => row.active && !row.fixedPrice).map((row) => ({ id: row.id }));
}

/** Does an active MINING template fit this location (the port screen's Mining tab)? */
export function miningEligible(snapshot: Snapshot, world: FillerWorld, locationId: string): boolean {
  const location = world.locations.find((row) => row.id === locationId);
  if (location === undefined) return false;
  return isMiningEligible(location, world.templates);
}

export interface MineGates {
  readonly ok: boolean;
  readonly reason: string;
}

/** The job's own gates, before anything is built: minable place, a rig in the sheet, ores. */
export function canMine(
  state: PlayerState,
  ctx: MissionContext,
  world: FillerWorld,
): MineGates {
  if (!miningEligible(ctx.snapshot, world, state.locationId)) {
    return { ok: false, reason: 'NOT_MINABLE' };
  }
  const installed = installedParts(state.ship, ctx.catalogByType);
  const sheet = deriveSheet(installed, ctx.rules);
  if (sheet.min < 1) return { ok: false, reason: 'NO_MINING_RIG' };
  if (!checkViability(sheet, installed, ctx.rules).viable) {
    return { ok: false, reason: 'SHIP_NOT_VIABLE' };
  }
  if (oresOf(ctx.snapshot).length === 0) return { ok: false, reason: 'NOT_MINABLE' };
  return { ok: true, reason: 'ok' };
}

export interface MiningOfferInput {
  readonly snapshot: Snapshot;
  readonly world: FillerWorld;
  readonly state: PlayerState;
  readonly nowMs: number;
}

/** The free MINING offer for the ship's current location, or null when there is no route. */
export function miningOffer(input: MiningOfferInput): Offer | null {
  const { snapshot, world, state, nowMs } = input;
  const locationId = state.locationId;
  const location = snapshot.locations.find((row) => row.id === locationId);
  if (location === undefined) return null;
  const routes = snapshot.routes
    .filter((route) => route.nodeAId === locationId || route.nodeBId === locationId)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const route = routes[0];
  if (route === undefined) return null;
  const danger = routes.reduce((peak, entry) => Math.max(peak, entry.danger), 0);
  // A distance that makes the dig last `job_duration_seconds` for THIS ship (mission time).
  const sheet = deriveSheet(installedParts(state.ship, catalogIndex(snapshot)), snapshot.rules);
  const distance = Math.max(
    1,
    Math.round(
      (snapshot.rules.mining.job_duration_seconds /
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
    env: { ...base.env, fuelMult: MINING_FUEL_MULT },
  };
  const seed = `mining|${SIM_PLAYER_ID}|${locationId}|${nowMs}`;
  const ores = oresOf(snapshot);
  if (ores.length === 0) return null;
  const materialId = createRng(seed).child('mining-pick').pick(ores).id;
  const template = snapshot.templates.find((row) => row.id === MINING_JOB_TEMPLATE_ID);
  return {
    id: seed,
    seed,
    templateId: MINING_JOB_TEMPLATE_ID,
    type: 'MINING',
    factionId: state.factionId,
    originId: locationId,
    destinationId: locationId,
    legs: [leg],
    // Free mode: no required quantity, no pay/fail gate; keep whatever the dig turns up.
    cargo: { materialId, contracted: false },
    reward: 0,
    expiresAtMs: nowMs + JOB_OFFER_TTL_MS,
    deadlineAtMs: null,
    starter: false,
    requirements: template?.requirements ?? {},
    encounterPolicy: template?.encounterPolicy ?? {},
  };
}

export type MineOutcome =
  | {
      readonly ok: true;
      readonly durationSeconds: number;
      readonly materialId: string;
      readonly status: string;
      /** A job that comes back adrift still needs the real tow (the bot pays it). */
      readonly shipStatus: 'ON_MISSION' | 'ADRIFT';
    }
  | { readonly ok: false; readonly reason: string };

/** Run one free mining job at the ship's current location (see the file header on the tally). */
export function mine(
  state: PlayerState,
  ctx: MissionContext,
  world: FillerWorld,
  nowMs: number,
): MineOutcome {
  const gates = canMine(state, ctx, world);
  if (!gates.ok) return { ok: false, reason: gates.reason };
  const offer = miningOffer({ snapshot: ctx.snapshot, world, state, nowMs });
  if (offer === null) return { ok: false, reason: 'NO_ROUTE' };
  const check = canTakeMission(state, offer, ctx);
  if (!check.ok) return { ok: false, reason: check.reasons.join(',') };
  const rawMaterial = offer.cargo['materialId'];
  const materialId = typeof rawMaterial === 'string' ? rawMaterial : '';
  const result = takeMission(state, offer, ctx);
  // A job is not a mission on the run's tally (see the file header).
  state.missionsDone -= 1;
  return {
    ok: true,
    durationSeconds: result.durationSeconds,
    materialId,
    status: result.status,
    shipStatus: result.shipStatus,
  };
}
