/**
 * Layer 3 — statistical parity with the production PRNG (plan S5.10).
 *
 * Bands come from `baselines.json` (oracle-measured with sampling-noise
 * tolerance). Sample sizes match the oracle recording sizes.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSheetsFromTapes,
  canonicalRules,
  loadCombatTapes,
  TORNEIO_BUILD_ORDER,
  tournamentFixedOrder,
  tournamentSymmetrized,
} from './tournament.js';
import { configsFromTapes, loadLifeTapes, runLifeSweep } from './life-sim.js';

const oracleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/oracle');

interface Baselines {
  layer3: {
    tournament_fixed_order: {
      n_per_pair: number;
      band: { build_min: number; build_max: number; spread_max: number };
    };
    tournament_symmetrized: {
      n_per_order: number;
      band: { build_min: number; build_max: number; spread_max: number };
    };
    life_sweep: {
      n_lives: number;
      seed: number;
      band: {
        bankruptcy_pct: number;
        combat_winrate: [number, number];
        missions_tier2_median: [number, number];
        missions_tier5_median: Record<string, [number, number]>;
        choke_pct_max: number;
        median_margin: [number, number];
      };
    };
  };
}

const baselines = JSON.parse(
  readFileSync(path.join(oracleDir, 'baselines.json'), 'utf8'),
) as Baselines;

const combatFixture = loadCombatTapes();
const lifeFixture = loadLifeTapes();
const sheets = buildSheetsFromTapes(combatFixture);
const rules = canonicalRules();
const names = TORNEIO_BUILD_ORDER as readonly string[];

describe('S5.10 Layer 3 — tournament fixed order', () => {
  it('each build stays in 43–58 and spread ≤ 13.5', () => {
    const band = baselines.layer3.tournament_fixed_order.band;
    const { n_per_pair: nPerPair } = baselines.layer3.tournament_fixed_order;
    const result = tournamentFixedOrder(sheets, names, nPerPair, rules, 'layer3-fixed');
    for (const name of names) {
      const wr = result.winrates[name]!;
      expect({ name, wr }).toEqual({ name, wr: expect.any(Number) });
      expect(wr).toBeGreaterThanOrEqual(band.build_min);
      expect(wr).toBeLessThanOrEqual(band.build_max);
    }
    expect(result.spread).toBeLessThanOrEqual(band.spread_max);
  }, 120_000);
});

describe('S5.10 Layer 3 — tournament symmetrized', () => {
  it('each build stays in 39–57 and spread ≤ 15', () => {
    const band = baselines.layer3.tournament_symmetrized.band;
    const { n_per_order: nPerOrder } = baselines.layer3.tournament_symmetrized;
    const result = tournamentSymmetrized(sheets, names, nPerOrder, rules, 'layer3-sym');
    for (const name of names) {
      const wr = result.winrates[name]!;
      expect(wr).toBeGreaterThanOrEqual(band.build_min);
      expect(wr).toBeLessThanOrEqual(band.build_max);
    }
    expect(result.spread).toBeLessThanOrEqual(band.spread_max);
  }, 120_000);
});

describe('S5.10 Layer 3 — life sweep bands', () => {
  it('2000 lives × 3 configs: bankruptcy 0%, winrate/tier/choke/margin in band', () => {
    const band = baselines.layer3.life_sweep.band;
    const { n_lives: nLives, seed } = baselines.layer3.life_sweep;
    const configs = configsFromTapes(lifeFixture);
    expect(configs).toHaveLength(3);

    const sweeps = runLifeSweep(configs, nLives, seed);
    for (const { name, aggregate } of sweeps) {
      expect({ name, n: aggregate.n }).toEqual({ name, n: nLives });
      expect({ name, falencia: aggregate.falenciaPct }).toEqual({
        name,
        falencia: 0,
      });
      expect(aggregate.falenciaPct).toBeLessThanOrEqual(band.bankruptcy_pct);
      expect(aggregate.combatWinrate).toBeGreaterThanOrEqual(band.combat_winrate[0]);
      expect(aggregate.combatWinrate).toBeLessThanOrEqual(band.combat_winrate[1]);
      expect(aggregate.missionsTier2Median).toBeGreaterThanOrEqual(band.missions_tier2_median[0]);
      expect(aggregate.missionsTier2Median).toBeLessThanOrEqual(band.missions_tier2_median[1]);
      const t5Band = band.missions_tier5_median[name];
      expect(t5Band).toBeDefined();
      if (t5Band !== undefined) {
        expect(aggregate.missionsTier5Median).toBeGreaterThanOrEqual(t5Band[0]);
        expect(aggregate.missionsTier5Median).toBeLessThanOrEqual(t5Band[1]);
      }
      expect(aggregate.engasgoPct).toBeLessThanOrEqual(band.choke_pct_max);
      expect(aggregate.medianMargin).toBeGreaterThanOrEqual(band.median_margin[0]);
      expect(aggregate.medianMargin).toBeLessThanOrEqual(band.median_margin[1]);
    }
  }, 600_000);
});
