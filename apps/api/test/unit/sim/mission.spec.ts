import { describe, expect, it } from '@jest/globals';
import { missionDuration } from '../../../src/missions/duration.calculator.js';
import { missionReward } from '../../../src/missions/mission.reward.js';
import { integrityMultiplier, rewardBase } from '../../../src/economy/reward.calculator.js';
import { deriveSheet } from '../../../src/ships/sheet.deriver.js';
import {
  canTakeMission,
  missionContext,
  takeMission,
} from '../../../sim/actions/mission.js';
import { catalogIndex, installedParts, starterPlayer } from '../../../sim/core/state.js';
import type { Offer } from '../../../sim/core/world.js';
import { fixtureSnapshot } from './fixture.js';

const snapshot = fixtureSnapshot();
const ctx = missionContext(snapshot);
const TAKEN_AT_MS = Date.parse(snapshot.takenAt);

function offerOf(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'test-offer',
    seed: 'test-offer',
    templateId: 'delivery_luna',
    type: 'DELIVERY',
    factionId: 'luna',
    originId: 'ceres',
    destinationId: 'tycho',
    legs: [
      {
        routeId: 'ceres-tycho',
        distance: 515,
        danger: 2,
        zone: 0,
        env: { id: 'open', level: 1, fuelMult: 1 },
      },
    ],
    cargo: {},
    reward: 100,
    expiresAtMs: TAKEN_AT_MS + 600_000,
    deadlineAtMs: null,
    starter: false,
    requirements: {},
    encounterPolicy: { missionForcesFlee: true },
    ...overrides,
  };
}

describe('canTakeMission', () => {
  it('accepts the starter ship for a plain delivery at its home port', () => {
    const state = starterPlayer(snapshot, 'luna');
    const check = canTakeMission(state, offerOf(), ctx);
    expect(check.ok).toBe(true);
  });

  it('refuses an unmet requirement and changes nothing', () => {
    const state = starterPlayer(snapshot, 'luna');
    const walletBefore = state.wallet;
    const clockBefore = state.clock.now();
    const check = canTakeMission(state, offerOf({ requirements: { cargo: 99 } }), ctx);
    expect(check.ok).toBe(false);
    expect(check.reasons).toContain('CARGO_TYPE');
    expect(state.wallet).toBe(walletBefore);
    expect(state.clock.now()).toBe(clockBefore);
  });

  it('refuses a ship that is not at the origin', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.locationId = 'tycho';
    const check = canTakeMission(state, offerOf(), ctx);
    expect(check.ok).toBe(false);
    expect(check.reasons).toContain('SHIP_NOT_AT_ORIGIN');
  });

  it('refuses when the tank cannot cover the trip', () => {
    const state = starterPlayer(snapshot, 'luna');
    state.ship.fuel = 1;
    const check = canTakeMission(state, offerOf(), ctx);
    expect(check.ok).toBe(false);
    expect(check.reasons).toContain('NOT_ENOUGH_FUEL');
  });
});

describe('takeMission', () => {
  it('flies a delivery with the real resolver and pays reward × integrity', () => {
    const state = starterPlayer(snapshot, 'luna');
    const offer = offerOf();
    const result = takeMission(state, offer, ctx);

    expect(result.type).toBe('DELIVERY');
    expect(result.originId).toBe('ceres');
    expect(result.destinationId).toBe('tycho');
    expect(result.status).toBe('success');
    expect(state.locationId).toBe('tycho');
    expect(state.missionsDone).toBe(1);

    // The resolver pays rewardBase(tier, danger, distance) × integrity, and the sim's
    // `rewardOffered` is the same base rounded at accept (missionReward).
    const base = rewardBase(
      { tier: 1, danger: 2, distance: 515, missionType: 'DELIVERY' },
      ctx.rules,
    );
    const expectedPaid = Math.round(base * integrityMultiplier(result.integrity, ctx.rules));
    expect(result.rewardOffered).toBe(missionReward({ legs: offer.legs as never, type: offer.type }, 1, ctx.rules));
    expect(result.rewardPaid).toBe(expectedPaid);
    expect(state.wallet).toBe(snapshot.rules.economy.start_credits + expectedPaid);
  });

  it('advances the clock by the mission duration, not a made-up number', () => {
    const state = starterPlayer(snapshot, 'luna');
    const offer = offerOf();
    const sheet = deriveSheet(installedParts(state.ship, catalogIndex(snapshot)), ctx.rules);
    const result = takeMission(state, offer, ctx);
    const { durationSeconds } = missionDuration({
      totalDistance: 515,
      mobility: sheet.mob,
      durationK: ctx.rules.missions.duration_k,
      timeScale: ctx.rules.missions.time_scale,
      classCutoffs: ctx.rules.missions.duration_class_cutoffs,
    });
    expect(result.durationSeconds).toBe(durationSeconds);
    expect(state.clock.now()).toBe(durationSeconds);
  });

  it('is deterministic: the same seed flies the same mission twice', () => {
    const first = takeMission(starterPlayer(snapshot, 'luna'), offerOf(), ctx);
    const second = takeMission(starterPlayer(snapshot, 'luna'), offerOf(), ctx);
    expect(second).toEqual(first);
  });
});
