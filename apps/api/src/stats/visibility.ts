import type { RecordKey, StatKey, StatRecords, StatTotals } from './stat-keys.js';

/** What other pilots may see on a pilot's card. Everything not listed here is private. */
export const PUBLIC_STAT_KEYS: readonly StatKey[] = [
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
];

export const PUBLIC_RECORD_KEYS: readonly RecordKey[] = ['best.race_place', 'best.race_seconds'];

/** The totals and records another pilot is allowed to see. */
export function publicView(
  totals: StatTotals,
  records: StatRecords,
): { totals: StatTotals; records: StatRecords } {
  const publicTotals: StatTotals = {};
  for (const key of PUBLIC_STAT_KEYS) {
    const value = totals[key];
    if (value !== undefined) publicTotals[key] = value;
  }
  const publicRecords: StatRecords = {};
  for (const key of PUBLIC_RECORD_KEYS) {
    const record = records[key];
    if (record !== undefined) publicRecords[key] = record;
  }
  return { totals: publicTotals, records: publicRecords };
}
