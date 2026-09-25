import { describe, expect, it } from '@jest/globals';
import {
  SWEEP_WINRATE_BASELINE,
  normalizeWalletReason,
  summarizeCombat,
  summarizeOutcomes,
  summarizeZones,
  sumWalletFlows,
  tierHistogram,
} from './analytics.helpers.js';

describe('normalizeWalletReason (S11.3)', () => {
  it('buckets dynamic wallet reasons onto stable categories', () => {
    expect(normalizeWalletReason('repair.start:ship-1')).toBe('repair');
    expect(normalizeWalletReason('refuel:ship-1')).toBe('refuel');
    expect(normalizeWalletReason('market.buy:listing-1')).toBe('market.buy');
    expect(normalizeWalletReason('market.sell:part-1')).toBe('market.sell');
    expect(normalizeWalletReason('market.sell_material:cobalt')).toBe('market.sell');
    expect(normalizeWalletReason('mission:abc-123:payout')).toBe('mission.payout');
    expect(normalizeWalletReason('onboarding starter credits')).toBe('onboarding');
    expect(normalizeWalletReason('something:new')).toBe('something');
  });
});

describe('sumWalletFlows (S11.3)', () => {
  it('splits entering vs leaving with per-reason breakdowns sorted by total', () => {
    const flows = sumWalletFlows([
      { reason: 'onboarding starter credits', entering: 100, leaving: 0 },
      { reason: 'mission.payout', entering: 50, leaving: 0 },
      { reason: 'repair.start', entering: 0, leaving: 30 },
      { reason: 'refuel', entering: 0, leaving: 10 },
      { reason: 'market.buy', entering: 0, leaving: 5 },
      { reason: 'support.grant', entering: 1000, leaving: 0 },
      { reason: 'support.remove', entering: 0, leaving: 200 },
    ]);
    expect(flows.adjustments).toEqual({ granted: 1000, removed: 200 });
    expect(flows.entering).toBe(150);
    expect(flows.leaving).toBe(45);
    expect(flows.net).toBe(105);
    expect(flows.sources).toEqual([
      { reason: 'onboarding', total: 100 },
      { reason: 'mission.payout', total: 50 },
    ]);
    expect(flows.sinks).toEqual([
      { reason: 'repair', total: 30 },
      { reason: 'refuel', total: 10 },
      { reason: 'market.buy', total: 5 },
    ]);
  });

  it('returns zeroed totals for an empty window', () => {
    expect(sumWalletFlows([])).toEqual({
      entering: 0,
      leaving: 0,
      net: 0,
      sources: [],
      sinks: [],
      adjustments: { granted: 0, removed: 0 },
    });
  });
});

describe('summarizeOutcomes (S11.3)', () => {
  it('counts the outcome union and derives success / total', () => {
    expect(
      summarizeOutcomes([
        { outcome: 'success', count: 2 },
        { outcome: 'partial_failure', count: 1 },
        { outcome: 'failed', count: 1 },
        { outcome: 'adrift', count: 1 },
      ]),
    ).toEqual({
      total: 5,
      success: 2,
      partialFailure: 1,
      failed: 1,
      adrift: 1,
      successRate: 0.4,
    });
  });

  it('ignores unknown outcome strings and reports 0 on an empty window', () => {
    expect(summarizeOutcomes([{ outcome: 'something_else', count: 3 }])).toEqual({
      total: 0,
      success: 0,
      partialFailure: 0,
      failed: 0,
      adrift: 0,
      successRate: 0,
    });
  });
});

describe('summarizeCombat (S11.3)', () => {
  it('derives encounters and the winrate rounded to 4 decimals', () => {
    expect(summarizeCombat(2, 2)).toEqual({ encounters: 4, wins: 2, losses: 2, winrate: 0.5 });
    expect(summarizeCombat(1, 2).winrate).toBe(0.3333);
  });

  it('reports zero when nothing fought', () => {
    expect(summarizeCombat(0, 0)).toEqual({ encounters: 0, wins: 0, losses: 0, winrate: 0 });
  });

  it('exposes the sweep baseline constant (GDD §17 screen A)', () => {
    expect(SWEEP_WINRATE_BASELINE).toBe(0.55);
  });
});

describe('tierHistogram (S11.3)', () => {
  it('initializes every tier and counts ships', () => {
    expect(tierHistogram([1, 1, 5, 5, 5])).toEqual({
      tiers: { 1: 2, 2: 0, 3: 0, 4: 0, 5: 3 },
      ships: 5,
    });
    expect(tierHistogram([])).toEqual({ tiers: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, ships: 0 });
  });
});

describe('summarizeZones (S11.3)', () => {
  it('merges generation and consumption per zone, sorted by zone, dropping unknown origins', () => {
    const zoneByOrigin = new Map([
      ['ceres', 0],
      ['vesta', 2],
    ]);
    expect(
      summarizeZones(
        [
          { originId: 'vesta', count: 4 },
          { originId: 'ceres', count: 2 },
          { originId: 'unknown', count: 9 },
        ],
        [{ originId: 'ceres', count: 1 }],
        zoneByOrigin,
      ),
    ).toEqual([
      { zone: 0, generated: 2, consumed: 1 },
      { zone: 2, generated: 4, consumed: 0 },
    ]);
  });
});
