import { describe, expect, it } from '@jest/globals';
import { playRun } from '../../../sim/bots/bot.js';
import { fixtureSnapshot } from './fixture.js';

const snapshot = fixtureSnapshot();

describe('playRun (Phase 1 bot)', () => {
  it('flies the requested number of missions without stalling', () => {
    const result = playRun({ snapshot, seed: 7, missions: 8 });
    expect(result.totalMissions).toBe(8);
    expect(result.stalled).toBe(false);
    expect(result.factionId).toBe('luna');
    expect(result.missions.every((mission) => mission.durationSeconds > 0)).toBe(true);
    expect(result.missions.every((mission) => mission.seq > 0)).toBe(true);
    // Free restore: every mission is flown in a whole, fueled ship.
    expect(result.successRate).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed', () => {
    const first = playRun({ snapshot, seed: 3, missions: 6 });
    const second = playRun({ snapshot, seed: 3, missions: 6 });
    expect(second.missions).toEqual(first.missions);
    expect(second.ledgerTotals).toEqual(first.ledgerTotals);
    expect(second.levels).toEqual(first.levels);
  });

  it('accounts for every credit in the wallet and the ledger', () => {
    const result = playRun({ snapshot, seed: 11, missions: 5 });
    const paid = result.missions.reduce((sum, mission) => sum + mission.rewardPaid, 0);
    expect(result.ledgerTotals.reward).toBe(paid);
    expect(result.ledgerTotals.fuel).toBe(0);
    expect(result.ledgerTotals.repair).toBe(0);
  });

  it('starts at level 1 and records the first level at t=0', () => {
    const result = playRun({ snapshot, seed: 5, missions: 3 });
    expect(result.levels[0]).toMatchObject({ level: 1, t: 0, missions: 0 });
    expect(result.finalLevel).toBeGreaterThanOrEqual(1);
  });
});
