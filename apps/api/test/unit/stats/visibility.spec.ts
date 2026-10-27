import { describe, expect, it } from '@jest/globals';
import { RECORD_KEYS, STAT_KEYS } from '../../../src/stats/stat-keys.js';
import { PUBLIC_RECORD_KEYS, PUBLIC_STAT_KEYS, publicView } from '../../../src/stats/visibility.js';

describe('stat keys', () => {
  it('has no duplicate keys', () => {
    expect(new Set(STAT_KEYS).size).toBe(STAT_KEYS.length);
    expect(new Set(RECORD_KEYS).size).toBe(RECORD_KEYS.length);
  });
});

describe('visibility', () => {
  // Written out on purpose: making a stat public must be a deliberate edit of this test too.
  it('shows exactly these totals and records to other pilots', () => {
    expect([...PUBLIC_STAT_KEYS].sort()).toEqual(
      [
        'missions.started',
        'missions.success',
        'missions.failed',
        'flight.distance',
        'fights.won',
        'races.entered',
        'races.won',
        'races.podium',
        'scavenge.ship_runs',
        'scavenge.foot_runs',
      ].sort(),
    );
    expect([...PUBLIC_RECORD_KEYS].sort()).toEqual(['best.race_place', 'best.race_seconds']);
  });

  it('every public key is a known key', () => {
    for (const key of PUBLIC_STAT_KEYS) expect(STAT_KEYS).toContain(key);
    for (const key of PUBLIC_RECORD_KEYS) expect(RECORD_KEYS).toContain(key);
  });

  it('publicView drops every private key', () => {
    const view = publicView(
      { 'money.earned_missions': 5, 'flight.distance': 9 },
      {
        'best.payout': { value: 1, at: '2026-10-27T00:00:00.000Z' },
        'best.race_place': { value: 2, at: '2026-10-27T00:00:00.000Z' },
      },
    );
    expect(view.totals).toEqual({ 'flight.distance': 9 });
    expect(Object.keys(view.records)).toEqual(['best.race_place']);
  });
});
