import type { MissionStatus } from '@prisma/client';

// S6.4 owns hold/release/accept/expire; S7.2 adds DISPATCH (ACCEPTED → IN_TRANSIT);
// S7.3 adds RESOLVE (claim IN_TRANSIT → RESOLVING) and the COMPLETE/FAIL finish pair.
// S7.4 may add the reconciler's RESOLVING → IN_TRANSIT reclaim with its own spec rows.
export const MISSION_EVENTS = [
  'HOLD',
  'RELEASE',
  'ACCEPT',
  'EXPIRE',
  'DISPATCH',
  'RESOLVE',
  'COMPLETE',
  'FAIL',
] as const;
export type MissionEvent = (typeof MISSION_EVENTS)[number];

const TABLE: Readonly<
  Record<MissionStatus, Readonly<Partial<Record<MissionEvent, MissionStatus>>>>
> = {
  AVAILABLE: { HOLD: 'HELD', ACCEPT: 'ACCEPTED', EXPIRE: 'EXPIRED' },
  HELD: { RELEASE: 'AVAILABLE', ACCEPT: 'ACCEPTED', EXPIRE: 'EXPIRED' },
  ACCEPTED: { DISPATCH: 'IN_TRANSIT' },
  IN_TRANSIT: { RESOLVE: 'RESOLVING' },
  RESOLVING: { COMPLETE: 'DONE', FAIL: 'FAILED' },
  DONE: {},
  FAILED: {},
  EXPIRED: {},
};

export function missionStatusAfter(from: MissionStatus, event: MissionEvent): MissionStatus | null {
  return TABLE[from][event] ?? null;
}
