import { describe, expect, it } from 'vitest';
import { legRouteIds, summarizeLegs } from './mission-facts';

describe('summarizeLegs', () => {
  it('reads defensively from untyped JSON', () => {
    expect(summarizeLegs([{ distance: 400, danger: 2, zone: 1 }, { distance: 300, danger: 5, zone: 2 }])).toEqual(
      { legCount: 2, totalDistance: 700, peakDanger: 5, peakZone: 2 },
    );
    expect(summarizeLegs(null)).toEqual({ legCount: 0, totalDistance: 0, peakDanger: 0, peakZone: 0 });
  });
});

// Round-10 owner request: "in My Ship, before dispatch the mission ... I cannot see the
// origin -> destination". The pre-dispatch screen has no leg WINDOWS yet (those are written
// at dispatch), but it already has the mission's static leg plan — this reads routeId out of
// that plan the same defensive way summarizeLegs reads distance/danger/zone.
describe('legRouteIds', () => {
  it('extracts routeId from each leg of the stored plan, in order', () => {
    expect(
      legRouteIds([{ routeId: 'r1', distance: 400 }, { routeId: 'r2', distance: 300 }]),
    ).toEqual(['r1', 'r2']);
  });

  it('skips a leg with no string routeId instead of throwing', () => {
    expect(legRouteIds([{ routeId: 'r1' }, { distance: 10 }, { routeId: 42 }])).toEqual(['r1']);
  });

  it('is empty for anything that is not an array', () => {
    expect(legRouteIds(null)).toEqual([]);
    expect(legRouteIds(undefined)).toEqual([]);
  });
});
