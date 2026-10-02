// The trip a mission's stored leg plan describes, in numbers a pilot cares about. The server
// stores `legs` as JSON ({ routeId, distance, danger, zone, env }); this reads it defensively
// because it is untyped on the wire.
export interface LegsSummary {
  readonly legCount: number;
  readonly totalDistance: number;
  readonly peakDanger: number;
  readonly peakZone: number;
}

/** The routeId of each leg in the stored plan, in order — available before dispatch, unlike
    leg WINDOWS (written pro-rata only once the mission is actually dispatched). Lets the
    pre-dispatch screen show the planned route (origin → ... → destination) same as the
    in-transit one does. */
export function legRouteIds(legs: unknown): string[] {
  const list = Array.isArray(legs) ? (legs as Array<Record<string, unknown>>) : [];
  return list
    .map((leg) => leg['routeId'])
    .filter((routeId): routeId is string => typeof routeId === 'string');
}

export function summarizeLegs(legs: unknown): LegsSummary {
  const list = Array.isArray(legs) ? (legs as Array<Record<string, unknown>>) : [];
  const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return {
    legCount: list.length,
    totalDistance: list.reduce((sum, leg) => sum + number(leg['distance']), 0),
    peakDanger: list.reduce((peak, leg) => Math.max(peak, number(leg['danger'])), 0),
    peakZone: list.reduce((peak, leg) => Math.max(peak, number(leg['zone'])), 0),
  };
}
