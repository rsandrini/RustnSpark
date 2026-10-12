import { describe, expect, it } from '@jest/globals';
import { playRun } from '../../../sim/bots/bot.js';
import { fixtureSnapshot } from './fixture.js';

const snapshot = fixtureSnapshot();

describe('playRun (the bot loop)', () => {
  it('flies the requested number of missions without stalling', () => {
    const result = playRun({ snapshot, seed: 7, missions: 8 });
    expect(result.totalMissions).toBe(8);
    expect(result.stalled).toBe(false);
    expect(result.factionId).toBe('luna');
    expect(result.missions.every((mission) => mission.durationSeconds > 0)).toBe(true);
    expect(result.missions.every((mission) => mission.seq > 0)).toBe(true);
    // Phase 2: no free restore — fuel and repairs are bought between missions.
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
    // Phase 2: fuel is bought at real prices, so the run spends on it.
    expect(result.ledgerTotals.fuel).toBeLessThan(0);
    // The wallet change is exactly the ledger's net flow — no credit appears from nowhere.
    const net = Object.values(result.ledgerTotals).reduce((sum, v) => sum + v, 0);
    expect(result.finalWallet - result.startWallet).toBe(net);
  });

  it('starts at level 1 and records the first level at t=0', () => {
    const result = playRun({ snapshot, seed: 5, missions: 3 });
    expect(result.levels[0]).toMatchObject({ level: 1, t: 0, missions: 0 });
    expect(result.finalLevel).toBeGreaterThanOrEqual(1);
  });

  it('keeps finding work on a long run instead of stalling at a thin board', () => {
    const result = playRun({ snapshot, seed: 7, missions: 30 });
    expect(result.stalled).toBe(false);
    expect(result.totalMissions).toBe(30);
    // A run long enough to wear the ship: repair money is spent, and the wallet still
    // reconciles with the ledger.
    expect(result.ledgerTotals.repair).toBeLessThan(0);
    const net = Object.values(result.ledgerTotals).reduce((sum, v) => sum + v, 0);
    expect(result.finalWallet - result.startWallet).toBe(net);
  });
});
