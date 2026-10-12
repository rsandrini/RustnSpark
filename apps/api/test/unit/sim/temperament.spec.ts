import { describe, expect, it } from '@jest/globals';
import { chooseOffer, temperamentOf } from '../../../sim/bots/temperament.js';
import { missionContext } from '../../../sim/actions/mission.js';
import { starterPlayer } from '../../../sim/core/state.js';
import { createRng } from '../../../sim/core/rng.js';
import type { Offer } from '../../../sim/core/world.js';
import { fixtureSnapshot } from './fixture.js';

const snapshot = fixtureSnapshot();
const ctx = missionContext(snapshot);

function offerOf(id: string, reward: number, danger: number, distance = 500): Offer {
  return {
    id,
    seed: id,
    templateId: 'delivery_luna',
    type: 'DELIVERY',
    factionId: 'luna',
    originId: 'ceres',
    destinationId: 'tycho',
    legs: [
      {
        routeId: 'ceres-tycho',
        distance,
        danger,
        zone: 0,
        env: { id: 'open', level: 1, fuelMult: 1 },
      },
    ],
    cargo: {},
    reward,
    expiresAtMs: 0,
    deadlineAtMs: null,
    starter: false,
    requirements: {},
    encounterPolicy: {},
  };
}

describe('temperamentOf', () => {
  it('passes the four named temperaments through', () => {
    expect(temperamentOf('greedy')).toBe('greedy');
    expect(temperamentOf('balanced')).toBe('balanced');
    expect(temperamentOf('safe')).toBe('safe');
    expect(temperamentOf('random')).toBe('random');
  });

  it('falls back to random for an unknown string', () => {
    expect(temperamentOf('yolo')).toBe('random');
    expect(temperamentOf('')).toBe('random');
  });
});

describe('chooseOffer', () => {
  const state = starterPlayer(snapshot, 'luna');

  it('needs at least one offer', () => {
    expect(() => chooseOffer('greedy', [], state, ctx, createRng(1))).toThrow();
  });

  it('returns the only offer whatever the temperament', () => {
    const only = offerOf('only', 100, 9);
    for (const temperament of ['greedy', 'balanced', 'safe', 'random'] as const) {
      expect(chooseOffer(temperament, [only], state, ctx, createRng(1))).toBe(only);
    }
  });

  it('greedy takes the best net-per-hour job, not the biggest purse', () => {
    const rich = offerOf('rich', 500, 3, 2000); // long haul, slow
    const quick = offerOf('quick', 200, 3, 200); // short hop, fast
    expect(chooseOffer('greedy', [rich, quick], state, ctx, createRng(1))).toBe(quick);
  });

  it('greedy breaks a reward tie by lower danger, then by id', () => {
    const calm = offerOf('calm', 300, 1);
    const wild = offerOf('wild', 300, 8);
    expect(chooseOffer('greedy', [wild, calm], state, ctx, createRng(1))).toBe(calm);
    const alpha = offerOf('alpha', 300, 2);
    const bravo = offerOf('bravo', 300, 2);
    expect(chooseOffer('greedy', [bravo, alpha], state, ctx, createRng(1))).toBe(alpha);
  });

  it('balanced skips the top risk band and takes the median of the rest', () => {
    const low1 = offerOf('low1', 100, 2);
    const low2 = offerOf('low2', 200, 2);
    const low3 = offerOf('low3', 300, 2);
    const high = offerOf('high', 999, 9);
    // Pool after dropping danger 9: three offers, median by reward = low2.
    expect(chooseOffer('balanced', [low1, high, low2, low3], state, ctx, createRng(1)))
      .toBe(low2);
  });

  it('balanced falls back to the whole board when one band covers everything', () => {
    const first = offerOf('first', 100, 4);
    const second = offerOf('second', 200, 4);
    const third = offerOf('third', 300, 4);
    // All danger 4 → median of three by reward = second.
    expect(chooseOffer('balanced', [third, first, second], state, ctx, createRng(1)))
      .toBe(second);
  });

  it('safe takes the calmest job, then the cheapest zone, then the richest', () => {
    const calmRichLowZone = offerOf('calm', 100, 1);
    const calmPoorHighZone = offerOf('calm-zone', 900, 1);
    // Same danger; both zone 0 here, so the richer one wins only after danger ties.
    expect(chooseOffer('safe', [calmPoorHighZone, calmRichLowZone], state, ctx, createRng(1)))
      .toBe(calmPoorHighZone);
    const wild = offerOf('wild', 9999, 9);
    expect(chooseOffer('safe', [wild, calmRichLowZone], state, ctx, createRng(1)))
      .toBe(calmRichLowZone);
  });

  it('random is a seeded draw over the board', () => {
    const offers = [offerOf('a', 100, 1), offerOf('b', 200, 2), offerOf('c', 300, 3)];
    const first = chooseOffer('random', offers, state, ctx, createRng(42));
    const second = chooseOffer('random', offers, state, ctx, createRng(42));
    expect(second.id).toBe(first.id);
    expect(offers.map((offer) => offer.id)).toContain(first.id);
  });
});
