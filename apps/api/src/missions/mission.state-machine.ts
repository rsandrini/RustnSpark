import type { MissionStatus } from '@prisma/client';

// S6.4 owns hold/release/accept/expire; S7 adds the execution events by extending
// this table together with its exhaustive spec.
export const MISSION_EVENTS = ['HOLD', 'RELEASE', 'ACCEPT', 'EXPIRE'] as const;
export type MissionEvent = (typeof MISSION_EVENTS)[number];

const TABLE: Readonly<
  Record<MissionStatus, Readonly<Partial<Record<MissionEvent, MissionStatus>>>>
> = {
  AVAILABLE: { HOLD: 'HELD', ACCEPT: 'ACCEPTED', EXPIRE: 'EXPIRED' },
  HELD: { RELEASE: 'AVAILABLE', ACCEPT: 'ACCEPTED', EXPIRE: 'EXPIRED' },
  ACCEPTED: {},
  IN_TRANSIT: {},
  RESOLVING: {},
  DONE: {},
  FAILED: {},
  EXPIRED: {},
};

export function missionStatusAfter(from: MissionStatus, event: MissionEvent): MissionStatus | null {
  return TABLE[from][event] ?? null;
}
