import type { LegWindow, WorldLocation, WorldRoute } from '../../api/generated';

// The route the ship flies is a chain of legs; each leg names a route, and a route is
// undirected. Walking the chain from the origin gives the node the ship is at between legs.
// Everything here is presentation: the server already sent the timing of every leg.

export interface JourneyStop {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

export interface ShipPosition {
  readonly x: number;
  readonly y: number;
  /** Direction of travel in degrees (0 = right, 90 = down): where the ship's nose points. */
  readonly heading: number;
  /** True while the ship is sitting at a node (before departure or after the last leg). */
  readonly docked: boolean;
  /** Index of the leg being flown, or -1 when docked. */
  readonly legIndex: number;
  /** 0..1 progress along the current leg. */
  readonly legProgress: number;
}

/** Node ids visited by a journey: the origin followed by the far end of each leg. */
export function journeyNodeIds(
  originId: string,
  windows: readonly Pick<LegWindow, 'routeId'>[],
  routes: readonly WorldRoute[],
): string[] {
  const nodes = [originId];
  let current = originId;
  for (const window of windows) {
    const route = routes.find((entry) => entry.id === window.routeId);
    if (route === undefined) break;
    current = route.nodeAId === current ? route.nodeBId : route.nodeAId;
    nodes.push(current);
  }
  return nodes;
}

export function journeyStops(
  nodeIds: readonly string[],
  locations: readonly WorldLocation[],
): JourneyStop[] {
  const byId = new Map(locations.map((location) => [location.id, location]));
  return nodeIds.flatMap((id) => {
    const location = byId.get(id);
    return location === undefined ? [] : [{ id, x: location.x, y: location.y }];
  });
}

/** Where the ship is at `nowMs`, interpolated along the leg whose window contains it. */
export function positionAt(
  stops: readonly JourneyStop[],
  windows: readonly Pick<LegWindow, 'from' | 'to'>[],
  nowMs: number,
): ShipPosition | null {
  const first = stops[0];
  if (first === undefined) return null;
  const headingOf = (a: JourneyStop, b: JourneyStop) =>
    (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index]!;
    const from = stops[index];
    const to = stops[index + 1];
    if (from === undefined || to === undefined) break;
    const start = Date.parse(window.from);
    const end = Date.parse(window.to);
    if (nowMs < start) {
      const previous = stops[index - 1];
      return {
        x: from.x,
        y: from.y,
        heading: headingOf(previous ?? from, previous === undefined ? to : from),
        docked: index === 0,
        legIndex: index === 0 ? -1 : index,
        legProgress: 0,
      };
    }
    if (nowMs < end) {
      const progress = end > start ? (nowMs - start) / (end - start) : 1;
      return {
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
        heading: headingOf(from, to),
        docked: false,
        legIndex: index,
        legProgress: progress,
      };
    }
  }
  const last = stops[stops.length - 1] ?? first;
  const beforeLast = stops[stops.length - 2] ?? last;
  return {
    x: last.x,
    y: last.y,
    heading: headingOf(beforeLast, last),
    docked: true,
    legIndex: -1,
    legProgress: 1,
  };
}
