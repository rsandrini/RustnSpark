import type { MissionType, Prisma } from '@prisma/client';
import type { Rng } from '../../common/rng/rng.js';
import { createRng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';
import { rewardBase } from '../../economy/reward.calculator.js';
import type { LegRoute } from '../../resolution/leg/leg.resolver.js';
import { generateCompetitors } from '../../resolution/race/race.resolver.js';

// Board offer lifetime: the prototype board shows offers expiring in 6–40 minutes
// (prototypes/quadro-missoes-esboco.html); TTL is drawn per mission inside that window.
const BOARD_EXPIRY_MIN_SECONDS = 360; // 6 minutes
const BOARD_EXPIRY_MAX_SECONDS = 2400; // 40 minutes
const MS_PER_SECOND = 1000;

// Mining contracts (design missoes §4 "dois modos"): v0.1 placeholder split and quantity
// range, both explicitly listed as calibratable later (design missoes §8).
//
// Quantity is capped low because a single mining stop rolls attempts_per_stop independent
// find rolls and each success yields one unit. A starter rig (MIN 1) in open space has a
// ~14% find chance per attempt → expected yield of ~1.4 units per mission. Asking for 5-10
// units made contracted mining "almost always fail" even though the recent cap prevented
// values above attempts_per_stop. Keeping the max at 3 keeps common-rarity contracts
// achievable for starter rigs while rarer materials still reward upgrading the rig.
const CONTRACTED_CHANCE = 0.5;
const MIN_CONTRACT_QUANTITY = 1;
const MAX_CONTRACT_QUANTITY = 3;

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
 * leave Sun with no route at all). `maxDistance` caps the first mission's path length (0 = off);
 * when even the nearest destination is longer, the nearest still goes — a long first mission
 * beats no first mission. Everything else about generation is unchanged, so a starter mission
 * is an ordinary mission that happens to be easy to take and hard to lose.
 */
export interface StarterConstraint {
  readonly types: readonly MissionType[];
  readonly maxZone: number;
  readonly maxDistance: number;
  /**
   * The pilot's very first mission: it goes to the small test pad next to the home port when there is
   * one (seconds there and back), not to a trading place.
   */
  readonly firstMission?: boolean;
}

export interface FillMissionInput {
  readonly seed: string;
  readonly origin: FillerLocation;
  readonly world: FillerWorld;
  readonly rules: GameRules;
  readonly now: Date;
  readonly starter?: StarterConstraint;
  /**
   * Types the board does not have yet: when a template of one of them fits the place, the pick is made among those
   * first, so a board shows every type it can before any type repeats.
   */
  readonly preferTypes?: ReadonlySet<MissionType>;
}

export type MissionDraft = Prisma.MissionInstanceUncheckedCreateInput;

interface TemplateRequirements {
  readonly originFactions?: readonly string[];
  readonly originTypes?: readonly string[];
  /** Where the mission may end: a location of one of these types (a race to an empty place). */
  readonly destinationTypes?: readonly string[];
  /** Where the mission may end: exactly one of these locations. */
  readonly destinationIds?: readonly string[];
  /** A mining offer may only name these materials (a far field that only holds rare crystals). */
  readonly materialIds?: readonly string[];
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
    destinationTypes?: unknown;
    destinationIds?: unknown;
    materialIds?: unknown;
  };
  return {
    originFactions: Array.isArray(raw.originFactions)
      ? (raw.originFactions as string[])
      : undefined,
    originTypes: Array.isArray(raw.originTypes) ? (raw.originTypes as string[]) : undefined,
    destinationTypes: Array.isArray(raw.destinationTypes)
      ? (raw.destinationTypes as string[])
      : undefined,
    destinationIds: Array.isArray(raw.destinationIds)
      ? (raw.destinationIds as string[])
      : undefined,
    materialIds: Array.isArray(raw.materialIds) ? (raw.materialIds as string[]) : undefined,
  };
}

/**
 * The materials a mining run at `origin` can dig. Every ore, unless the mining templates offered
 * there pin some (`materialIds`): then only those, so a far field can hold nothing but rare crystals.
 */
export function miningMaterialsFor<M extends FillerMaterial>(
  origin: FillerLocation,
  templates: readonly FillerTemplate[],
  materials: readonly M[],
): M[] {
  const pinned = new Set<string>();
  let anyUnpinned = false;
  for (const template of templates) {
    if (!template.active || template.type !== 'MINING' || !matchesOrigin(origin, template))
      continue;
    const ids = requirementsOf(template).materialIds;
    if (ids === undefined) anyUnpinned = true;
    else for (const id of ids) pinned.add(id);
  }
  if (anyUnpinned || pinned.size === 0) return [...materials];
  const narrowed = materials.filter((material) => pinned.has(material.id));
  return narrowed.length > 0 ? narrowed : [...materials];
}

/**
 * Places no ordinary mission may end at: the far deep fields and the far stations beyond them. They are reached by long, hostile
 * routes a starter ship cannot fly, so a template only goes there when it names them itself
 * (`destinationIds` / `destinationTypes`).
 */
const OPT_IN_PLACE_TYPES: ReadonlySet<string> = new Set([
  'deep_field',
  'far_station',
  'far_field',
  'test_pad',
]);

/**
 * The small service stops next to the main places (repair and refuel, no market). An ordinary mission may end at
 * one, but a new pilot's first mission never does: it should end somewhere they can trade.
 */
const SERVICE_STOP_TYPES: ReadonlySet<string> = new Set([
  'drydock',
  'scrapyard',
  'fuel_depot',
  'mining_claim',
  'waystation',
]);

/** Whether `destination` is a place this template may end at (no condition = anywhere). */
function matchesDestination(
  destination: FillerLocation,
  template: FillerTemplate,
  allowTestPad = false,
): boolean {
  const requirements = requirementsOf(template);
  const named =
    requirements.destinationIds !== undefined || requirements.destinationTypes !== undefined;
  if (OPT_IN_PLACE_TYPES.has(destination.type) && !named) {
    // the first mission may go to the test pad next to the home port, and nowhere else that is opt-in
    if (!(allowTestPad && destination.type === 'test_pad')) return false;
  }
  const typeMatch =
    requirements.destinationTypes === undefined ||
    requirements.destinationTypes.includes(destination.type);
  const idMatch =
    requirements.destinationIds === undefined ||
    requirements.destinationIds.includes(destination.id);
  return typeMatch && idMatch;
}

/** Whether this template can only end at a far, opt-in place (a new pilot cannot fly there). */
function endsAtOptInPlace(template: FillerTemplate, world: FillerWorld): boolean {
  const named = world.locations.filter((location) => matchesDestination(location, template));
  return named.length > 0 && named.every((location) => OPT_IN_PLACE_TYPES.has(location.type));
}

function matchesOrigin(origin: FillerLocation, template: FillerTemplate): boolean {
  const requirements = requirementsOf(template);
  // A test pad offers only what names it (its way back to the port): never the ordinary templates.
  if (origin.type === 'test_pad' && requirements.originTypes?.includes('test_pad') !== true)
    return false;
  const factionMatch =
    requirements.originFactions === undefined ||
    requirements.originFactions.includes(origin.factionId);
  const typeMatch =
    requirements.originTypes === undefined || requirements.originTypes.includes(origin.type);
  return factionMatch && typeMatch;
}

/**
 * Whether `origin` is a "minable location" (round 10: independent mining jobs) — the same
 * eligibility a MINING board template already uses, so "minable" never drifts from whatever
 * the admin-tunable MissionTemplate rows already say about where mining is offered.
 */
export function isMiningEligible(
  origin: FillerLocation,
  templates: readonly FillerTemplate[],
): boolean {
  return templates.some(
    (template) => template.active && template.type === 'MINING' && matchesOrigin(origin, template),
  );
}

/** The mission types a place can post at all (the types of the templates that fit it). */
export function eligibleTypesAt(origin: FillerLocation, world: FillerWorld): Set<MissionType> {
  return new Set(eligibleTemplates(origin, world).map((template) => template.type));
}

function eligibleTemplates(origin: FillerLocation, world: FillerWorld): FillerTemplate[] {
  return (
    world.templates
      .filter((template) => template.active)
      // Pilot-requested trips are never board offers.
      .filter((template) => template.type !== 'TRAVEL' && template.type !== 'SCAVENGE')
      // A mining board offer is meaningless without a material to name.
      .filter((template) => template.type !== 'MINING' || world.materials.length > 0)
      .filter((template) => matchesOrigin(origin, template))
      // A template that must end somewhere specific is only offered where such a place exists
      // other than the origin itself.
      .filter((template) =>
        world.locations.some(
          (location) => location.id !== origin.id && matchesDestination(location, template),
        ),
      )
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

/** The materials one mining template may name: its own pinned list, else every one. */
function pinnedMaterials(
  template: FillerTemplate,
  materials: readonly FillerMaterial[],
): readonly FillerMaterial[] {
  const ids = requirementsOf(template).materialIds;
  if (ids === undefined) return materials;
  const narrowed = materials.filter((material) => ids.includes(material.id));
  return narrowed.length > 0 ? narrowed : materials;
}

function miningCargo(
  rng: Rng,
  materials: readonly FillerMaterial[],
  rules: GameRules,
): Record<string, unknown> {
  const material = rng.child('mining').pick(materials);
  const contracted = rng.child('contracted').float() < CONTRACTED_CHANCE;
  if (contracted) {
    // A single mining stop can yield at most attempts_per_stop units (mining.resolver.ts
    // rolls that many independent attempts, one unit each) — a contract above that cap is
    // unfulfillable no matter the ship's rig, so it is clamped to never exceed it.
    const maxQuantity = Math.min(MAX_CONTRACT_QUANTITY, rules.mining.attempts_per_stop);
    return {
      materialId: material.id,
      contracted: true,
      quantity: rng.child('quantity').int(MIN_CONTRACT_QUANTITY, maxQuantity),
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
    (candidate) =>
      input.starter === undefined ||
      (input.starter.types.includes(candidate.type) && !endsAtOptInPlace(candidate, world)),
  );
  const preferred =
    input.preferTypes === undefined
      ? []
      : eligible.filter((candidate) => input.preferTypes?.has(candidate.type) === true);
  const pool = preferred.length > 0 ? preferred : eligible;
  const template = pool.length > 0 ? rng.child('template').pick(pool) : undefined;
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
  const reachable = world.locations
    .filter((location) => {
      if (location.id === origin.id) return false;
      if (!matchesDestination(location, template, input.starter?.firstMission === true))
        return false;
      const candidatePath = shortestPath(origin.id, location.id, adjacency);
      return candidatePath !== null && withinStarterZone(candidatePath);
    })
    .sort(byId);
  // A first mission is a short one: of everywhere reachable inside the safe zones, the NEAREST
  // destination within the distance cap is offered — deterministic, so the first result comes
  // fast and from the same nearby place every time (the usual board keeps the whole map in play
  // and picks freely).
  const pathLength = (locationId: string): number =>
    (shortestPath(origin.id, locationId, adjacency) ?? []).reduce(
      (sum, route) => sum + route.distance,
      0,
    );
  const byDistance = (x: FillerLocation, y: FillerLocation): number =>
    pathLength(x.id) - pathLength(y.id) || byId(x, y);
  let destination: FillerLocation | undefined;
  if (input.starter === undefined) {
    destination = reachable.length > 0 ? rng.child('destination').pick(reachable) : undefined;
  } else {
    const { maxDistance } = input.starter;
    const pads =
      input.starter.firstMission === true
        ? reachable.filter((location) => location.type === 'test_pad')
        : [];
    const tradeable = reachable.filter(
      (location) => !SERVICE_STOP_TYPES.has(location.type) && location.type !== 'test_pad',
    );
    const choices = pads.length > 0 ? pads : tradeable.length > 0 ? tradeable : reachable;
    const sorted = [...choices].sort(byDistance);
    const withinCap =
      maxDistance > 0
        ? sorted.filter((location) => pathLength(location.id) <= maxDistance)
        : sorted;
    destination = (withinCap.length > 0 ? withinCap : sorted)[0];
  }
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

  // A race's rivals are drawn with the offer and frozen in its cargo: the board shows who you would
  // race, and the resolution plays against exactly those ships.
  const cargo =
    template.type === 'MINING'
      ? miningCargo(rng, pinnedMaterials(template, world.materials), rules)
      : template.type === 'RACE'
        ? { race: { competitors: generateCompetitors(rng.child('race'), rules) } }
        : {};

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
    ) * (template.type === 'RACE' ? rules.race.prize_share_1 : 1),
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
