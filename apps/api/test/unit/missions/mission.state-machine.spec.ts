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

// The whole transition table: S6.4's four reservation events, S7.2's DISPATCH,
// S7.3's resolve triple (RESOLVE claims IN_TRANSIT → RESOLVING; COMPLETE/FAIL finish
// the claim from RESOLVING), and S7.4's REQUEUE (the reconciler returns a stuck
// RESOLVING claim to IN_TRANSIT). Every other (status, event) pair is rejected — including
// terminal states, other in-flight statuses, and holding an already-held mission.
const ALLOWED: readonly Allowed[] = [
  ['AVAILABLE', 'HOLD', 'HELD'],
  ['AVAILABLE', 'ACCEPT', 'ACCEPTED'],
  ['AVAILABLE', 'EXPIRE', 'EXPIRED'],
  ['HELD', 'RELEASE', 'AVAILABLE'],
  ['HELD', 'ACCEPT', 'ACCEPTED'],
  ['HELD', 'EXPIRE', 'EXPIRED'],
  ['ACCEPTED', 'DISPATCH', 'IN_TRANSIT'],
  ['IN_TRANSIT', 'RESOLVE', 'RESOLVING'],
  ['RESOLVING', 'COMPLETE', 'DONE'],
  ['RESOLVING', 'FAIL', 'FAILED'],
  ['RESOLVING', 'REQUEUE', 'IN_TRANSIT'],
];

describe('mission state machine (S6.4 + S7.3 resolve + S7.4 requeue)', () => {
  it('pins the event set through S7.4', () => {
    expect(MISSION_EVENTS).toEqual([
      'HOLD',
      'RELEASE',
      'ACCEPT',
      'EXPIRE',
      'DISPATCH',
      'RESOLVE',
      'COMPLETE',
      'FAIL',
      'REQUEUE',
    ]);
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

  it('rejects every other in-flight or terminal status for the reservation events', () => {
    const reservationEvents = ['HOLD', 'RELEASE', 'ACCEPT', 'EXPIRE'] as const;
    const ownedElsewhere: readonly MissionStatus[] = [
      'ACCEPTED',
      'IN_TRANSIT',
      'RESOLVING',
      'DONE',
      'FAILED',
      'EXPIRED',
    ];
    for (const from of ownedElsewhere) {
      for (const event of reservationEvents) {
        expect(missionStatusAfter(from, event)).toBeNull();
      }
    }
    // DISPATCH is legal only from ACCEPTED; the exhaustive test covers the rest.
    for (const from of ['IN_TRANSIT', 'RESOLVING', 'DONE', 'FAILED', 'EXPIRED'] as const) {
      expect(missionStatusAfter(from, 'DISPATCH')).toBeNull();
    }
  });

  it('restricts RESOLVE to IN_TRANSIT and the finish events to RESOLVING', () => {
    for (const from of STATUSES) {
      expect(missionStatusAfter(from, 'RESOLVE')).toBe(from === 'IN_TRANSIT' ? 'RESOLVING' : null);
      const finish = missionStatusAfter(from, 'COMPLETE');
      const fail = missionStatusAfter(from, 'FAIL');
      if (from === 'RESOLVING') {
        expect(finish).toBe('DONE');
        expect(fail).toBe('FAILED');
      } else {
        expect(finish).toBeNull();
        expect(fail).toBeNull();
      }
    }
  });

  it('restricts REQUEUE to RESOLVING — the reconciler reclaim path (S7.4)', () => {
    for (const from of STATUSES) {
      expect(missionStatusAfter(from, 'REQUEUE')).toBe(from === 'RESOLVING' ? 'IN_TRANSIT' : null);
    }
  });
});
