import type { WorldResponse } from '../../api/generated';

type Route = Pick<WorldResponse['routes'][number], 'nodeAId' | 'nodeBId' | 'distance'>;

/** Place id -> cheapest route distance from the origin, for places within the budget. */
export function reachableWithin(
  routes: readonly Route[],
  originId: string,
  budget: number,
): Map<string, number> {
  const adj = new Map<string, Array<[string, number]>>();
  const link = (a: string, b: string, d: number) => {
    const list = adj.get(a);
    if (list) list.push([b, d]);
    else adj.set(a, [[b, d]]);
  };
  for (const route of routes) {
    link(route.nodeAId, route.nodeBId, route.distance);
    link(route.nodeBId, route.nodeAId, route.distance);
  }
  const best = new Map<string, number>([[originId, 0]]);
  const done = new Set<string>();
  for (;;) {
    let current: string | null = null;
    let currentDist = Infinity;
    for (const [id, d] of best) {
      if (!done.has(id) && d < currentDist) {
        current = id;
        currentDist = d;
      }
    }
    if (current === null) break;
    done.add(current);
    for (const [next, d] of adj.get(current) ?? []) {
      const total = currentDist + d;
      if (total <= budget && total < (best.get(next) ?? Infinity)) best.set(next, total);
    }
  }
  return best;
}

/** Route distance the fuel on board covers; autonomy is the full-tank distance. */
export function rangeBudget(input: {
  autonomy: number;
  fuelUse: number;
  fuelHave: number;
  fuelCap: number;
}): number | 'unlimited' {
  if (input.fuelUse <= 0) return 'unlimited';
  if (input.fuelCap <= 0) return 0;
  return input.autonomy * (input.fuelHave / input.fuelCap);
}
