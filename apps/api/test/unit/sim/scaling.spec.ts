import { describe, expect, it } from '@jest/globals';
import {
  bridgeRarityIndex,
  NO_SCALING,
  parseScaling,
  rewardMultiplier,
  scaleOffer,
} from '../../../sim/experiment/scaling.js';
import { missionContext, canTakeMission } from '../../../sim/actions/mission.js';
import { catalogIndex, starterPlayer } from '../../../sim/core/state.js';
import { fixtureSnapshot } from './fixture.js';
import type { Offer } from '../../../sim/core/world.js';

const snapshot = fixtureSnapshot();
const catalogByType = catalogIndex(snapshot);

function offerWith(requirements: Offer['requirements']): Offer {
  return {
    id: 'scaling-offer',
    seed: 'scaling-offer',
    templateId: 'delivery_luna',
    type: 'DELIVERY',
    factionId: 'luna',
    originId: 'ceres',
    destinationId: 'tycho',
    legs: [
      {
        routeId: 'ceres-tycho',
        distance: 100,
        danger: 1,
        zone: 0,
        env: { id: 'open', level: 1, fuelMult: 1 },
      },
    ],
    cargo: {},
    reward: 100,
    expiresAtMs: 0,
    deadlineAtMs: null,
    starter: false,
    requirements,
    encounterPolicy: {},
  };
}

describe('parseScaling', () => {
  it('is NO_SCALING when absent', () => {
    expect(parseScaling(undefined)).toBe(NO_SCALING);
    expect(parseScaling(null)).toBe(NO_SCALING);
  });

  it('accepts five-number axes', () => {
    const scaling = parseScaling({ reward: [1, 1, 2, 2, 3], cargo: [1, 1, 1, 1, 1], firepower: [1, 1, 1, 1, 1], mobility: [1, 1, 1, 1, 1] });
    expect(scaling.reward).toEqual([1, 1, 2, 2, 3]);
  });

  it('rejects a wrong-length axis', () => {
    expect(() => parseScaling({ reward: [1, 2] })).toThrow(/five numbers/);
  });
});

describe('bridgeRarityIndex', () => {
  it('is the common entry for the starter ship (a common bridge)', () => {
    const state = starterPlayer(snapshot, 'luna');
    expect(bridgeRarityIndex(state, catalogByType)).toBe(0);
  });

  it('is the common entry when no bridge is installed', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.ship.parts = state.ship.parts.filter(
      (part) => catalogByType.get(part.partType)?.partClass !== 'BRIDGE',
    );
    expect(bridgeRarityIndex(state, catalogByType)).toBe(0);
  });
});

describe('scaleOffer', () => {
  it('returns the same offer for NO_SCALING', () => {
    const offer = offerWith({ cargo: 5 });
    expect(scaleOffer(offer, NO_SCALING, 0)).toBe(offer);
  });

  it('multiplies the three numeric axes and leaves the rest alone', () => {
    const scaling = {
      reward: [1, 1, 2, 2, 3],
      cargo: [2, 2, 2, 2, 2],
      firepower: [3, 3, 3, 3, 3],
      mobility: [4, 4, 4, 4, 4],
    };
    const offer = offerWith({ cargo: 5, firepower: 2, mobility: 3, crew: 'nobody' });
    const scaled = scaleOffer(offer, scaling, 0);
    expect(scaled.requirements).toEqual({ cargo: 10, firepower: 6, mobility: 12, crew: 'nobody' });    // The original is untouched — the hook never mutates the board's offer.
    expect(offer.requirements).toEqual({ cargo: 5, firepower: 2, mobility: 3, crew: 'nobody' });
  });

  it('uses the entry for the given bridge rarity', () => {
    const scaling = {
      reward: [1, 1, 2, 2, 3],
      cargo: [1, 1, 3, 3, 3],
      firepower: [1, 1, 1, 1, 1],
      mobility: [1, 1, 1, 1, 1],
    };
    const offer = offerWith({ cargo: 4 });
    expect(scaleOffer(offer, scaling, 2).requirements).toEqual({ cargo: 12 });
  });
});

describe('rewardMultiplier', () => {
  it('is the entry for the bridge rarity, defaulting to the common entry', () => {
    const scaling = parseScaling({ reward: [1, 1.5, 2, 2.5, 4], cargo: [1, 1, 1, 1, 1], firepower: [1, 1, 1, 1, 1], mobility: [1, 1, 1, 1, 1] });
    expect(rewardMultiplier(scaling, 0)).toBe(1);
    expect(rewardMultiplier(scaling, 4)).toBe(4);
    expect(rewardMultiplier(scaling, 99)).toBe(1); // out of range -> common entry
  });
});

describe('missionContext + canTakeMission with scaling', () => {
  it('a doubled cargo requirement can refuse what the unscaled board allows', () => {
    // Starter hold is 5 cargo: a requirement of 4 fits today and fails when doubled.
    const offer = offerWith({ cargo: 4 });
    const state = starterPlayer(snapshot, 'luna');
    state.locationId = offer.originId;
    const doubling = {
      reward: [2, 2, 2, 2, 2],
      cargo: [2, 2, 2, 2, 2],
      firepower: [1, 1, 1, 1, 1],
      mobility: [1, 1, 1, 1, 1],
    };
    const base = missionContext(snapshot, NO_SCALING);
    const scaled = missionContext(snapshot, doubling);
    // The starter at its origin with fuel in the tank takes the 4-cargo job today...
    expect(canTakeMission(state, offer, base).ok).toBe(true);
    // ...and the same job is refused once the bridge table doubles the cargo ask.
    const check = canTakeMission(state, offer, scaled);
    expect(check.ok).toBe(false);
  });
});
