import type { GameRules } from '../config/game-config.types.js';

/**
 * A ship that runs out of fuel does not vanish into its origin port: it floats where it stopped,
 * on a route, between the node it left and the next one. From there the rescue tows it to the
 * nearest base, and the distance to that base is what an immediate rescue charges for.
 */
export interface RouteEdge {
  readonly id: string;
  readonly nodeAId: string;
  readonly nodeBId: string;
  readonly distance: number;
}

export interface FloatSpot {
  readonly routeId: string;
  /** The node the ship was leaving; it floats `progress` of the way towards the other end. */
  readonly fromId: string;
  readonly progress: number;
}

/** Places a ship can be towed to: where a pilot can dock, repair and trade. */
export const RESCUE_BASE_TYPES: ReadonlySet<string> = new Set([
  'port',
  'outpost',
  'garrison',
  'shipyard',
  'frontier',
]);

// A ship that ran dry always got a little way (not a dead stop on a node, not the far end).
const MIN_PROGRESS = 0.02;
const MAX_PROGRESS = 0.98;

function otherEnd(edge: RouteEdge, nodeId: string): string {
  return edge.nodeAId === nodeId ? edge.nodeBId : edge.nodeAId;
}

/** The nodes a journey walks through, start to end, from its first node and its route ids. */
export function pathNodes(
  originId: string,
  routeIds: readonly string[],
  routes: ReadonlyMap<string, RouteEdge>,
): string[] | null {
  const nodes = [originId];
  let here = originId;
  for (const routeId of routeIds) {
    const edge = routes.get(routeId);
    if (edge === undefined || (edge.nodeAId !== here && edge.nodeBId !== here)) return null;
    here = otherEnd(edge, here);
    nodes.push(here);
  }
  return nodes;
}

/**
 * Where a ship floats when it runs dry on leg `legIndex`: that leg's route, leaving the node the
 * journey had reached, as far as the fuel it still had would carry it (fuel left / the leg's burn).
 */
export function floatSpotOf(input: {
  readonly legIndex: number;
  readonly fuelLeft: number;
  readonly legBurn: number;
  readonly originId: string;
  readonly routeIds: readonly string[];
  readonly routes: ReadonlyMap<string, RouteEdge>;
}): FloatSpot | null {
  const nodes = pathNodes(input.originId, input.routeIds, input.routes);
  const routeId = input.routeIds[input.legIndex];
  const fromId = nodes?.[input.legIndex];
  if (nodes === null || routeId === undefined || fromId === undefined) return null;
  const share = input.legBurn > 0 ? input.fuelLeft / input.legBurn : 0;
  return { routeId, fromId, progress: Math.min(MAX_PROGRESS, Math.max(MIN_PROGRESS, share)) };
}

export interface TowPlan {
  /** The base the ship is towed to. */
  readonly baseId: string;
  /** Distance from the floating spot to that base. */
  readonly distance: number;
}

/** Shortest distance from every node to the nearest base (0 for a base itself). */
function distanceToBase(
  routes: readonly RouteEdge[],
  baseIds: ReadonlySet<string>,
): Map<string, { distance: number; baseId: string }> {
  const best = new Map<string, { distance: number; baseId: string }>();
  for (const baseId of baseIds) best.set(baseId, { distance: 0, baseId });
  // Bellman-Ford style relaxation: the graph is small (tens of nodes) and edges are undirected.
  for (let pass = 0; pass < routes.length + 1; pass += 1) {
    let changed = false;
    for (const edge of routes) {
      for (const [from, to] of [
        [edge.nodeAId, edge.nodeBId],
        [edge.nodeBId, edge.nodeAId],
      ] as const) {
        const via = best.get(to);
        if (via === undefined) continue;
        const candidate = via.distance + edge.distance;
        const known = best.get(from);
        if (known === undefined || candidate < known.distance) {
          best.set(from, { distance: candidate, baseId: via.baseId });
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return best;
}

/** The nearest base from a floating spot: along the route to either end, then on to a base. */
export function towPlanFor(
  spot: FloatSpot,
  routes: readonly RouteEdge[],
  baseIds: ReadonlySet<string>,
): TowPlan | null {
  const edge = routes.find((entry) => entry.id === spot.routeId);
  if (edge === undefined) return null;
  const toBase = distanceToBase(routes, baseIds);
  const options = [
    { nodeId: spot.fromId, along: edge.distance * spot.progress },
    { nodeId: otherEnd(edge, spot.fromId), along: edge.distance * (1 - spot.progress) },
  ]
    .map((option) => {
      const onward = toBase.get(option.nodeId);
      return onward === undefined
        ? null
        : { baseId: onward.baseId, distance: option.along + onward.distance };
    })
    .filter((option): option is TowPlan => option !== null);
  if (options.length === 0) return null;
  return options.reduce((best, option) => (option.distance < best.distance ? option : best));
}

export interface RescuePrices {
  /** Waiting for the rescue. */
  readonly wait: number;
  /** Calling it now: the waiting price plus a charge for the distance to the nearest base. */
  readonly now: number;
}

export function rescuePrices(distance: number, rules: GameRules): RescuePrices {
  const wait = Math.round(rules.economy.rescue_cost * rules.economy.rescue_wait_fraction);
  return { wait, now: wait + Math.round(distance * rules.economy.rescue_distance_price) };
}
