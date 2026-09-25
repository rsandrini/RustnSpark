import type { ActiveMission } from '../../api/generated';

/**
 * How often the transit screen asks the server for the active mission. Polling is the only way
 * the client learns a mission finished (it never decides that itself, S10.7), so the interval
 * follows what the mission is doing instead of a fixed 2 s tick:
 *
 *  - far from arrival: a slow heartbeat (4 requests/min per open tab);
 *  - near arrival or already past it (waiting for the worker to resolve): fast, briefly;
 *  - nothing in flight: an idle heartbeat.
 *
 * A hidden tab is not polled at all (TanStack pauses `refetchInterval` in the background).
 */
export const POLL_FAR_MS = 15_000;
export const POLL_NEAR_MS = 3_000;
export const POLL_IDLE_MS = 30_000;
/** Within this distance of `arrivalAt` (or past it) the fast interval applies. */
export const NEAR_ARRIVAL_MS = 30_000;

export function transitPollInterval(
  missions: readonly Pick<ActiveMission, 'status' | 'arrivalAt'>[] | undefined,
  serverNowMs: number,
): number {
  const mission = missions?.[0];
  if (mission === undefined) return POLL_IDLE_MS;
  if (mission.status === 'RESOLVING') return POLL_NEAR_MS;
  if (mission.status !== 'IN_TRANSIT' || mission.arrivalAt === null) return POLL_FAR_MS;
  const untilArrival = Date.parse(mission.arrivalAt) - serverNowMs;
  return untilArrival <= NEAR_ARRIVAL_MS ? POLL_NEAR_MS : POLL_FAR_MS;
}
