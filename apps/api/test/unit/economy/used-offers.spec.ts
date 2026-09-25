import { describe, expect, it } from '@jest/globals';
import {
  catalogListingId,
  dayKey,
  parseListingId,
  USED_OFFER_COUNT,
  usedListingId,
  usedOffer,
} from '../../../src/economy/used-offers.js';

/**
 * D25 daily used shelf, replayed over every day of a 400-day window at every port (T0.7).
 * A CI failure once showed a used-offer purchase answering 409 for a listing the board had
 * just shown; the shelf is pure now, so the whole invariant is checkable without a database
 * or a clock: whatever `market()` lists, `buy()` re-derives to the identical part and condition.
 */

const LOCATIONS = [
  'ceres',
  'hedus',
  'cair',
  'luna_port',
  'sun_gate',
  'belt_a',
  'belt_b',
  'outpost_1',
  'outpost_2',
  'frontier',
  'pirate_den',
  'gate',
];
// Active catalog sorted by partType, as the service reads it.
const CATALOG = [
  'armor_plate',
  'battery_small',
  'bridge',
  'cargo',
  'engine_chem_small',
  'engine_ion',
  'hull',
  'mining_rig',
  'shield_basic',
  'sensor_array',
  'tank_small',
  'weapon_cannon',
  'weapon_missile',
]
  .sort()
  .map((partType) => ({ partType }));

function days(count: number): string[] {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, offset) =>
    dayKey(new Date(start + offset * 24 * 60 * 60 * 1000)),
  );
}

describe('used offers (D25)', () => {
  it('every listed slot round-trips through its listing id to the same part and condition', () => {
    let checked = 0;
    for (const day of days(400)) {
      for (const locationId of LOCATIONS) {
        for (let index = 0; index < USED_OFFER_COUNT; index += 1) {
          const listed = usedOffer(locationId, day, index, CATALOG);
          expect(listed.part).toBeDefined();
          const id = usedListingId(locationId, day, index, listed.part!.partType);

          const parsed = parseListingId(id);
          expect(parsed).toEqual({
            kind: 'used',
            locationId,
            day,
            index,
            partType: listed.part!.partType,
          });
          // What buy() re-derives from the parsed id.
          const rederived = usedOffer(parsed!.locationId, parsed!.day!, parsed!.index!, CATALOG);
          expect(rederived).toEqual(listed);
          expect(Number.isInteger(listed.condition)).toBe(true);
          expect(listed.condition).toBeGreaterThanOrEqual(40);
          expect(listed.condition).toBeLessThanOrEqual(90);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(400 * LOCATIONS.length * USED_OFFER_COUNT);
  });

  it('is deterministic: same inputs, same shelf', () => {
    expect(usedOffer('ceres', '2026-09-25', 3, CATALOG)).toEqual(
      usedOffer('ceres', '2026-09-25', 3, CATALOG),
    );
  });

  it('varies by day and by port (the shelf is not a constant)', () => {
    const shelves = new Set(
      days(30).map((day) =>
        JSON.stringify(
          Array.from({ length: USED_OFFER_COUNT }, (_, i) => usedOffer('ceres', day, i, CATALOG)),
        ),
      ),
    );
    expect(shelves.size).toBeGreaterThan(20);
  });

  it('refuses ids outside the six listed slots or with malformed parts', () => {
    expect(parseListingId(`used:ceres:2026-09-25:${USED_OFFER_COUNT}:cargo`)).toBeNull();
    expect(parseListingId('used:ceres:2026-09-25:-1:cargo')).toBeNull();
    expect(parseListingId('used:ceres:25-09-2026:0:cargo')).toBeNull();
    expect(parseListingId('nonsense')).toBeNull();
  });

  it('parses catalog listing ids', () => {
    expect(parseListingId(catalogListingId('hedus', 'engine_chem_small'))).toEqual({
      kind: 'catalog',
      locationId: 'hedus',
      partType: 'engine_chem_small',
    });
  });

  it('names the shelf day in UTC, whatever offset the instant is written in', () => {
    expect(dayKey(new Date('2026-09-25T00:46:11Z'))).toBe('2026-09-25');
    expect(dayKey(new Date('2026-09-24T23:59:59Z'))).toBe('2026-09-24');
    // 21:30 in UTC-3 on the 24th is already the 25th in UTC.
    expect(dayKey(new Date('2026-09-24T21:30:00-03:00'))).toBe('2026-09-25');
  });
});
