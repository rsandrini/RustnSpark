import { describe, expect, it } from '@jest/globals';
import type { MissionStatus } from '@prisma/client';
import { MISSION_EVENTS, missionStatusAfter } from '../../../src/missions/mission.state-machine.js';

// The eight statuses of the MissionStatus enum (pinned independently by
// test/integration/missions-schema.int-spec.ts); iterating this literal keeps the
// state-machine spec pure (no @prisma/client runtime import needed to enumerate).
const STATUSES = [
  'AVAILABLE',
  'HELD',
  'ACCEPTED',
  'IN_TRANSIT',
  'RESOLVING',
  'DONE',
  'FAILED',
  'EXPIRED',
] as const satisfies readonly MissionStatus[];

type Allowed = readonly [MissionStatus, (typeof MISSION_EVENTS)[number], MissionStatus];

// The whole transition table for S6.4's four events. Every other (status, event)
// pair is rejected — including terminal states, in-flight statuses (owned by S7),
// and holding a mission that is already held.
const ALLOWED: readonly Allowed[] = [
  ['AVAILABLE', 'HOLD', 'HELD'],
  ['AVAILABLE', 'ACCEPT', 'ACCEPTED'],
  ['AVAILABLE', 'EXPIRE', 'EXPIRED'],
  ['HELD', 'RELEASE', 'AVAILABLE'],
  ['HELD', 'ACCEPT', 'ACCEPTED'],
  ['HELD', 'EXPIRE', 'EXPIRED'],
];

describe('mission state machine (S6.4)', () => {
  it('pins the S6.4 event set', () => {
    expect(MISSION_EVENTS).toEqual(['HOLD', 'RELEASE', 'ACCEPT', 'EXPIRE']);
  });

  it('iterates all eight mission statuses', () => {
    expect(STATUSES).toHaveLength(8);
    expect(new Set(STATUSES).size).toBe(STATUSES.length);
  });

  it('answers every status × event pair against the transition table (exhaustive)', () => {
    const allowed = new Map(ALLOWED.map(([from, event, to]) => [`${from}|${event}`, to]));
    expect(allowed.size).toBe(ALLOWED.length);

    let checked = 0;
    for (const from of STATUSES) {
      for (const event of MISSION_EVENTS) {
        const expected = allowed.get(`${from}|${event}`) ?? null;
        expect({ from, event, to: missionStatusAfter(from, event) }).toEqual({
          from,
          event,
          to: expected,
        });
        checked += 1;
      }
    }
    expect(checked).toBe(STATUSES.length * MISSION_EVENTS.length);
  });

  it('rejects every S7-owned and terminal status for all four S6.4 events', () => {
    const ownedElsewhere: readonly MissionStatus[] = [
      'ACCEPTED',
      'IN_TRANSIT',
      'RESOLVING',
      'DONE',
      'FAILED',
      'EXPIRED',
    ];
    for (const from of ownedElsewhere) {
      for (const event of MISSION_EVENTS) {
        expect(missionStatusAfter(from, event)).toBeNull();
      }
    }
  });
});
