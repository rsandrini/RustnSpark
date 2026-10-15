import { describe, expect, it } from '@jest/globals';
import {
  FALLBACK_WEAR_PER_DISTANCE,
  MAX_WEAR_COST_SHARE,
  expectedWear,
  isWorthFlying,
  tripKey,
  wearRate,
  type WearSample,
} from '../../../sim/bots/prudence.js';
import type { Offer } from '../../../sim/core/world.js';

function offer(over: Partial<Offer> = {}, legs = [{ distance: 1000, danger: 6 }]): Offer {
  return {
    id: 'o',
    seed: 's',
    templateId: 't',
    type: 'DELIVERY',
    factionId: 'luna',
    originId: 'a',
    destinationId: 'b',
    legs: legs.map((leg) => ({
      routeId: 'r',
      distance: leg.distance,
      danger: leg.danger,
      zone: 1,
      env: { id: 'open', level: 1, fuelMult: 1 },
    })),
    cargo: {},
    reward: 1000,
    expiresAtMs: 0,
    deadlineAtMs: null,
    starter: false,
    requirements: {},
    encounterPolicy: {},
    ...over,
  } as unknown as Offer;
}

describe('prudence', () => {
  it('has a fallback wear rate before the run has any sample', () => {
    expect(wearRate([], 5)).toBe(FALLBACK_WEAR_PER_DISTANCE);
    expect(expectedWear(offer(), [])).toBeCloseTo(FALLBACK_WEAR_PER_DISTANCE * 1000);
  });

  it('learns the wear rate from missions of similar danger first', () => {
    const samples: WearSample[] = [
      { distance: 400, danger: 2, wearPoints: 8 },
      { distance: 400, danger: 2, wearPoints: 12 },
      { distance: 1000, danger: 9, wearPoints: 300 },
      { distance: 1000, danger: 9, wearPoints: 300 },
    ];
    expect(wearRate(samples, 2)).toBeCloseTo(20 / 800);
    expect(wearRate(samples, 9)).toBeCloseTo(600 / 2000);
    // No samples near danger 5: all of them are averaged.
    expect(wearRate(samples, 5)).toBeCloseTo(620 / 2800);
  });

  it('refuses a trip whose repair bill eats most of its reward, flies one that pays', () => {
    const hard: WearSample[] = [
      { distance: 1000, danger: 9, wearPoints: 300 },
      { distance: 1000, danger: 9, wearPoints: 280 },
    ];
    const risky = offer({ reward: 900 }, [{ distance: 1200, danger: 9 }]);
    // ~350 points at 6 credits each = ~2,100 against a 900 reward.
    expect(isWorthFlying(risky, hard, 6)).toBe(false);
    const easy: WearSample[] = [
      { distance: 400, danger: 2, wearPoints: 10 },
      { distance: 400, danger: 2, wearPoints: 12 },
    ];
    const near = offer({ reward: 380 }, [{ distance: 400, danger: 2 }]);
    expect(isWorthFlying(near, easy, 6)).toBe(true);
    expect(MAX_WEAR_COST_SHARE).toBeGreaterThan(0);
  });

  it('remembers a trip by place and kind of work', () => {
    expect(tripKey(offer())).toBe('DELIVERY|a|b');
    expect(tripKey(offer({ type: 'RACE' }))).toBe('RACE|a|b');
  });
});
