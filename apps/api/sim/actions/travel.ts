/**
 * Repositioning: a bare `TRAVEL` mission (no cargo, no pay — only the fuel it burns and the wear
 * it inflicts), built exactly like `missions/travel.service.ts` builds one — shortest path by
 * distance, legs from `legForRoute`, resolved through the same `resolveMission` pipeline. The bot
 * uses this to reach a cheaper port when the one it sits at is too expensive.
 */
import {
  buildAdjacency,
  legForRoute,
  shortestPath,
} from '../../src/missions/generator/template.filler.js';
import type { FillerWorld } from '../../src/missions/generator/template.filler.js';
import type { Snapshot } from '../snapshot/types.js';
import type { PlayerState } from '../core/state.js';
import type { Offer } from '../core/world.js';
import { canTakeMission, takeMission, type MissionContext } from './mission.js';

/** The game's travel template id (`missions/travel.service.ts`). */
export const TRAVEL_TEMPLATE_ID = 'travel_generic';
/** A requested trip is created already accepted; the offer window only outlives the call. */
const TRAVEL_OFFER_TTL_MS = 3_600_000;

export interface TravelOfferInput {
  readonly snapshot: Snapshot;
  readonly world: FillerWorld;
  readonly state: PlayerState;
  readonly destinationId: string;
  readonly nowMs: number;
}

/** The TRAVEL offer from the player's port to `destinationId`, or null when there is no path. */
export function travelOffer(input: TravelOfferInput): Offer | null {
  const { snapshot, world, state, destinationId, nowMs } = input;
  if (destinationId === state.locationId) return null;
  const adjacency = buildAdjacency(world.routes);
  const path = shortestPath(state.locationId, destinationId, adjacency);
  if (path === null) return null;
  const locationsById = new Map(world.locations.map((location) => [location.id, location]));
  // `LegRoute` carries an optional routeId (hand-built legs); a real route always has one.
  const legs = path.map((route) => {
    const leg = legForRoute(route, locationsById, world);
    return {
      routeId: leg.routeId ?? route.id,
      distance: leg.distance,
      danger: leg.danger,
      zone: leg.zone,
      env: leg.env,
    };
  });
  const template = snapshot.templates.find((row) => row.id === TRAVEL_TEMPLATE_ID);
  const id = `travel|${state.locationId}|${destinationId}|${nowMs}`;
  return {
    id,
    seed: id,
    templateId: TRAVEL_TEMPLATE_ID,
    type: 'TRAVEL',
    factionId: state.factionId,
    originId: state.locationId,
    destinationId,
    legs,
    cargo: {},
    reward: 0,
    expiresAtMs: nowMs + TRAVEL_OFFER_TTL_MS,
    deadlineAtMs: null,
    starter: false,
    requirements: template?.requirements ?? {},
    encounterPolicy: template?.encounterPolicy ?? {},
  };
}

export interface TravelResult {
  readonly destinationId: string;
  readonly fuelBurned: number;
  readonly wearPoints: number;
  readonly status: string;
  readonly shipStatus: 'ON_MISSION' | 'ADRIFT';
}

/**
 * Fly a repositioning trip to `destinationId`. Returns null when the ship cannot get there on its
 * current tank (the caller decides whether to refuel first).
 */
export function travel(
  state: PlayerState,
  ctx: MissionContext,
  world: FillerWorld,
  destinationId: string,
  nowMs: number,
): TravelResult | null {
  const offer = travelOffer({ snapshot: ctx.snapshot, world, state, destinationId, nowMs });
  if (offer === null) return null;
  const check = canTakeMission(state, offer, ctx);
  if (!check.ok) return null;
  const result = takeMission(state, offer, ctx);
  return {
    destinationId,
    fuelBurned: result.fuelBurned,
    wearPoints: result.wearPoints,
    status: result.status,
    shipStatus: result.shipStatus,
  };
}
