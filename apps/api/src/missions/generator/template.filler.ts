import type { MissionType, Prisma } from '@prisma/client';
import type { Rng } from '../../common/rng/rng.js';
import { createRng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';
import { rewardBase } from '../../economy/reward.calculator.js';
import type { LegRoute } from '../../resolution/leg/leg.resolver.js';

// Board offer lifetime: the prototype board shows offers expiring in 6–40 minutes
// (prototypes/quadro-missoes-esboco.html); TTL is drawn per mission inside that window.
const BOARD_EXPIRY_MIN_SECONDS = 360; // 6 minutes
const BOARD_EXPIRY_MAX_SECONDS = 2400; // 40 minutes
const MS_PER_SECOND = 1000;

// Mining contracts (design missoes §4 "dois modos"): v0.1 placeholder split and quantity
// range, both explicitly listed as calibratable later (design missoes §8).
const CONTRACTED_CHANCE = 0.5;
const MIN_CONTRACT_QUANTITY = 5;
const MAX_CONTRACT_QUANTITY = 15;

// D29 finalizes reward from the accepting ship's tier; the stored figure is the
// provisional board value at generation time (starter-ship tier).
// Provisional difficulty tier until per-template tiers exist; exported so the S7.3 resolve
// processor rates payouts with the same value the board reward was computed from.
export const PROVISIONAL_TIER = 1;

export class MissionGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissionGenerationError';
  }
}

export interface FillerLocation {
  readonly id: string;
  readonly type: string;
  readonly zone: number;
  readonly factionId: string;
}

export interface FillerRoute {
  readonly id: string;
  readonly nodeAId: string;
  readonly nodeBId: string;
  readonly distance: number;
  readonly danger: number;
}

export interface FillerRouteEnvironment {
  readonly routeId: string;
  readonly environmentId: string;
  readonly order: number;
}

export interface FillerEnvironment {
  readonly id: string;
  readonly level: number;
  readonly fuelMult: number;
}

export interface FillerTemplate {
  readonly id: string;
  readonly type: MissionType;
  readonly factionId: string;
  readonly active: boolean;
  readonly requirements: unknown;
}

export interface FillerMaterial {
  readonly id: string;
}

export interface FillerWorld {
  readonly locations: readonly FillerLocation[];
  readonly routes: readonly FillerRoute[];
  readonly routeEnvironments: readonly FillerRouteEnvironment[];
  readonly environments: readonly FillerEnvironment[];
  readonly templates: readonly FillerTemplate[];
  readonly materials: readonly FillerMaterial[];
}

/**
 * D43 start-safe constraint: only these mission types, and only routes whose every leg stays
 * within `max(maxZone, origin.zone)` — the safe core, but never stricter than the port the
 * player already lives in (Sun's home, Hedus, is itself in zone 2, so a hard "zone ≤ 1" would
 * leave Sun with no route at all). Everything else about generation is unchanged, so a starter
 * mission is an ordinary mission that happens to be easy to take and hard to lose.
 */
export interface StarterConstraint {
  readonly types: readonly MissionType[];
  readonly maxZone: number;
}

export interface FillMissionInput {
  readonly seed: string;
  readonly origin: FillerLocation;
  readonly world: FillerWorld;
  readonly rules: GameRules;
  readonly now: Date;
  readonly starter?: StarterConstraint;
}

export type MissionDraft = Prisma.MissionInstanceUncheckedCreateInput;

interface TemplateRequirements {
  readonly originFactions?: readonly string[];
  readonly originTypes?: readonly string[];
}

interface Adjacent {
  readonly route: FillerRoute;
  readonly neighborId: string;
}

function byId(a: { readonly id: string }, b: { readonly id: string }): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function requirementsOf(template: FillerTemplate): TemplateRequirements {
  const raw = (template.requirements ?? {}) as {
    originFactions?: unknown;
    originTypes?: unknown;
  };
  return {
    originFactions: Array.isArray(raw.originFactions)
      ? (raw.originFactions as string[])
      : undefined,
    originTypes: Array.isArray(raw.originTypes) ? (raw.originTypes as string[]) : undefined,
  };
}

function eligibleTemplates(origin: FillerLocation, world: FillerWorld): FillerTemplate[] {
  return (
    world.templates
      .filter((template) => template.active)
      // Pilot-requested trips are never board offers.
      .filter((template) => template.type !== 'TRAVEL')
      // A mining board offer is meaningless without a material to name.
      .filter((template) => template.type !== 'MINING' || world.materials.length > 0)
      .filter((template) => {
        const requirements = requirementsOf(template);
        const factionMatch =
          requirements.originFactions === undefined ||
          requirements.originFactions.includes(origin.factionId);
        const typeMatch =
          requirements.originTypes === undefined || requirements.originTypes.includes(origin.type);
        return factionMatch && typeMatch;
      })
      .sort(byId)
  );
}

export function buildAdjacency(routes: readonly FillerRoute[]): Map<string, Adjacent[]> {
  const adjacency = new Map<string, Adjacent[]>();
  const sorted = [...routes].sort(byId);
  for (const route of sorted) {
    const fromA = adjacency.get(route.nodeAId);
    if (fromA) {
      fromA.push({ route, neighborId: route.nodeBId });
    } else {
      adjacency.set(route.nodeAId, [{ route, neighborId: route.nodeBId }]);
    }
    const fromB = adjacency.get(route.nodeBId);
    if (fromB) {
      fromB.push({ route, neighborId: route.nodeAId });
    } else {
      adjacency.set(route.nodeBId, [{ route, neighborId: route.nodeAId }]);
    }
  }
  for (const list of adjacency.values()) {
    list.sort((a, b) => byId({ id: a.neighborId }, { id: b.neighborId }) || byId(a.route, b.route));
  }
  return adjacency;
}

// Deterministic Dijkstra by distance: adjacency is pre-sorted and equal distances never
// displace an earlier discovery, so the same world always yields the same path.
export function shortestPath(
  originId: string,
  destinationId: string,
  adjacency: Map<string, Adjacent[]>,
): FillerRoute[] | null {
  const dist = new Map<string, number>();
  const prev = new Map<string, { nodeId: string; route: FillerRoute }>();
  const visited = new Set<string>();
  dist.set(originId, 0);

  for (;;) {
    let current: string | undefined;
    let currentDist = Number.POSITIVE_INFINITY;
    for (const [node, distance] of dist) {
      if (!visited.has(node) && distance < currentDist) {
        current = node;
        currentDist = distance;
      }
    }
    if (current === undefined || current === destinationId) break;
    visited.add(current);
    for (const { route, neighborId } of adjacency.get(current) ?? []) {
      if (visited.has(neighborId)) continue;
      const alternative = currentDist + route.distance;
      const known = dist.get(neighborId);
      if (known === undefined || alternative < known) {
        dist.set(neighborId, alternative);
        prev.set(neighborId, { nodeId: current, route });
      }
    }
  }

  if (!dist.has(destinationId)) return null;
  const path: FillerRoute[] = [];
  let node = destinationId;
  while (node !== originId) {
    const step = prev.get(node);
    if (step === undefined) return null;
    path.push(step.route);
    node = step.nodeId;
  }
  return path.reverse();
}

function environmentForRoute(routeId: string, world: FillerWorld): FillerEnvironment {
  const candidates = world.routeEnvironments
    .filter((entry) => entry.routeId === routeId)
    .sort((a, b) => a.order - b.order);
  const first = candidates[0];
  if (first === undefined) {
    throw new MissionGenerationError(`Missing route environment for route ${routeId}`);
  }
  const environment = world.environments.find((entry) => entry.id === first.environmentId);
  if (environment === undefined) {
    throw new MissionGenerationError(`Missing environment ${first.environmentId}`);
  }
  return environment;
}

// Zone of a leg is the riskier of its endpoints — same "max of the two nodes" rule the
// world builder uses for route danger (D24).
export function legForRoute(
  route: FillerRoute,
  locationsById: Map<string, FillerLocation>,
  world: FillerWorld,
): LegRoute {
  const nodeA = locationsById.get(route.nodeAId);
  const nodeB = locationsById.get(route.nodeBId);
  if (nodeA === undefined || nodeB === undefined) {
    throw new MissionGenerationError(`Route ${route.id} references an unknown location`);
  }
  const environment = environmentForRoute(route.id, world);
  return {
    routeId: route.id,
    distance: route.distance,
    danger: route.danger,
    zone: Math.max(nodeA.zone, nodeB.zone),
    env: { id: environment.id, level: environment.level, fuelMult: environment.fuelMult },
  };
}

function miningCargo(rng: Rng, materials: readonly FillerMaterial[]): Record<string, unknown> {
  const material = rng.child('mining').pick(materials);
  const contracted = rng.child('contracted').float() < CONTRACTED_CHANCE;
  if (contracted) {
    return {
      materialId: material.id,
      contracted: true,
      quantity: rng.child('quantity').int(MIN_CONTRACT_QUANTITY, MAX_CONTRACT_QUANTITY),
    };
  }
  return { materialId: material.id, contracted: false };
}

/**
 * Pure template filler (design missoes §7): one seed in, one ready-to-insert
 * MissionInstance draft out. Deterministic for a fixed seed + world + rules + now.
 * Rescue missions get an Appendix E deadline — round-trip time at reference_mob
 * scaled by duration_k, then a uniform(deadline_factor_min, deadline_factor_max)
 * slack factor — anchored at `now` (generation); legs are out-and-back.
 */
export function fillMission(input: FillMissionInput): MissionDraft {
  const rng = createRng(input.seed);
  const { origin, world, rules, now } = input;

  const eligible = eligibleTemplates(origin, world).filter(
    (candidate) => input.starter === undefined || input.starter.types.includes(candidate.type),
  );
  const template = eligible.length > 0 ? rng.child('template').pick(eligible) : undefined;
  if (template === undefined) {
    throw new MissionGenerationError(`No eligible mission template at location ${origin.id}`);
  }

  const adjacency = buildAdjacency(world.routes);
  const zoneOf = new Map(world.locations.map((location) => [location.id, location.zone]));
  const allowedZone =
    input.starter === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(input.starter.maxZone, origin.zone);
  const withinStarterZone = (path: FillerRoute[]): boolean =>
    path.every(
      (route) =>
        (zoneOf.get(route.nodeAId) ?? Number.POSITIVE_INFINITY) <= allowedZone &&
        (zoneOf.get(route.nodeBId) ?? Number.POSITIVE_INFINITY) <= allowedZone,
    );
  const destinations = world.locations
    .filter((location) => {
      if (location.id === origin.id) return false;
      const candidatePath = shortestPath(origin.id, location.id, adjacency);
      return candidatePath !== null && withinStarterZone(candidatePath);
    })
    .sort(byId);
  const destination =
    destinations.length > 0 ? rng.child('destination').pick(destinations) : undefined;
  if (destination === undefined) {
    throw new MissionGenerationError(`No reachable destination from location ${origin.id}`);
  }

  const path = shortestPath(origin.id, destination.id, adjacency);
  if (path === null) {
    throw new MissionGenerationError(`No path from ${origin.id} to ${destination.id}`);
  }
  const locationsById = new Map(world.locations.map((location) => [location.id, location]));
  const outbound = path.map((route) => legForRoute(route, locationsById, world));
  // Rescue is out-and-back (GDD §12): the return leg plan mirrors the outbound path.
  const legs: LegRoute[] =
    template.type === 'RESCUE' ? [...outbound, ...[...outbound].reverse()] : outbound;

  const cargo = template.type === 'MINING' ? miningCargo(rng, world.materials) : {};

  let deadlineAt: Date | null = null;
  if (template.type === 'RESCUE') {
    const totalDistance = legs.reduce((sum, leg) => sum + leg.distance, 0);
    const roundTripSeconds =
      (totalDistance / rules.rescue.reference_mob) * rules.missions.duration_k;
    const factor = rng
      .child('deadline')
      .uniform(rules.rescue.deadline_factor_min, rules.rescue.deadline_factor_max);
    deadlineAt = new Date(now.getTime() + Math.round(roundTripSeconds * factor * MS_PER_SECOND));
  }

  const ttlSeconds = rng
    .child('expiry')
    .uniform(BOARD_EXPIRY_MIN_SECONDS, BOARD_EXPIRY_MAX_SECONDS);
  const expiresAt = new Date(now.getTime() + Math.round(ttlSeconds * MS_PER_SECOND));

  const totalDistance = legs.reduce((sum, leg) => sum + leg.distance, 0);
  const maxDanger = legs.reduce((peak, leg) => (leg.danger > peak ? leg.danger : peak), 0);
  const reward = Math.round(
    rewardBase(
      {
        tier: PROVISIONAL_TIER,
        danger: maxDanger,
        distance: totalDistance,
        missionType: template.type,
      },
      rules,
    ),
  );

  return {
    templateId: template.id,
    type: template.type,
    factionId: template.factionId,
    originId: origin.id,
    destinationId: destination.id,
    legs: legs as unknown as Prisma.InputJsonValue,
    cargo: cargo as Prisma.InputJsonValue,
    reward,
    expiresAt,
    status: 'AVAILABLE',
    playerId: null,
    shipId: null,
    acceptedAt: null,
    arrivalAt: null,
    deadlineAt,
    seed: input.seed,
    version: 0,
  };
}
