/**
 * Layer 4 — production-mode health bands (plan S5.10 / D13).
 *
 * Production mode: per-part wear (`wear.scale_mode: all_stats`), integrity-
 * based payout (`payout = base × integrity`, 0 below 50%), first-strike +
 * 40-round combat with the canonical dials. The life loop mirrors `uma_vida`
 * structure but uses the production payout and wear rules. Combat uses the
 * validated sweep construction: pirate anchored to the nominal design sheet,
 * the player fights at the effective hull HP (`hp × performance`).
 *
 * Bands (`baselines.json` `layer4.band`) come from the sweep `ALVOS` where the
 * tuned oracle satisfies them; where the oracle itself sits outside ALVOS
 * (bankruptcy 0 < 2, tier5 ~99 > 55, median margin ~780 > 400) the band
 * anchors to oracle-measured reality (layer3). The first-green-run aggregate
 * is recorded as `layer4.baseline`. Drift is fixed by config
 * (reward_base / pirate strength), not code (D13).
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng, type Rng } from '../../src/common/rng/rng.js';
import { GAME_CONFIG_DEFAULTS } from '../../src/config/game-config.defaults.js';
import type { GameRules } from '../../src/config/game-config.types.js';
import { resolveCombat } from '../../src/resolution/combat/combat.resolver.js';
import type { CombatSheet } from '../../src/resolution/combat/combat.types.js';
import { generatePirate } from '../../src/resolution/encounter/pirate.generator.js';
import { missionWear, applyWear, defeatWear } from '../../src/resolution/wear/wear.calculator.js';
import { chokeChance } from '../../src/parts/condition.js';
import { roundHalfEven } from '../../src/resolution/numeric/round-half-even.js';
import { rewardBase, integrityPayout } from '../../src/economy/reward.calculator.js';
import {
  aggregateLives,
  ficha,
  performance,
  type Ficha,
  type UmaVidaConfig,
  type UmaVidaResult,
} from './life-sim.js';
import { configsFromTapes, loadLifeTapes } from './life-sim.js';

const oracleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/oracle');

interface Layer4Baseline {
  readonly falencia_pct: number;
  readonly combat_winrate: number;
  readonly tier5_pct: number;
  readonly missions_tier2_median: number;
  readonly missions_tier5_median: number;
  readonly engasgo_pct: number;
  readonly median_margin: number;
}

interface Layer4Band {
  readonly falencia_pct: readonly [number, number];
  readonly combat_winrate: readonly [number, number];
  readonly tier5_pct: readonly [number, number];
  readonly missions_tier2_median: readonly [number, number];
  readonly missions_tier5_median: readonly [number, number];
  readonly engasgo_pct: readonly [number, number];
  readonly median_margin: readonly [number, number];
}

interface Layer4 {
  readonly note: string;
  readonly n_lives_per_config: number;
  readonly baseline: Layer4Baseline;
  readonly band: Layer4Band;
}

const baselines = JSON.parse(readFileSync(path.join(oracleDir, 'baselines.json'), 'utf8')) as {
  layer4: Layer4;
};

const rules: GameRules = GAME_CONFIG_DEFAULTS;

// Test-only production life constants (same shop cadence as the sim harness).
const START_CREDITS = 200;
const START_TIER = 1;
const FUEL_FALLBACK = 1000;
const POST_UPGRADE_CONDITION = 90;
const BANKRUPTCY_FLOOR = -200;
const PART_COUNT = 7;

interface ProductionPart {
  id: string;
  condition: number;
}

/**
 * Production life: ship-wide average condition feeds performance/choke;
 * wear is drawn once per part (`all_stats`); payout is base × integrity.
 */
function productionVida(
  cfg: UmaVidaConfig,
  rng: Rng,
  envNivels: readonly number[] = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
): UmaVidaResult {
  let build: readonly string[] = [
    'ponte',
    'motor_p',
    'tanque',
    'bateria',
    'carga',
    'carga',
    'casco',
  ];
  let parts: ProductionPart[] = Array.from({ length: PART_COUNT }, (_, i) => ({
    id: `p${i}`,
    condition: cfg.peca_inicial_cond,
  }));
  let f = ficha(build);
  let creditos = START_CREDITS;
  let tier = START_TIER;
  let fuelMax = f.fuel || FUEL_FALLBACK;
  const foco = rng.pick(['carga', 'combate', 'minerador', 'rapido'] as const);
  const m = {
    missoes: 0,
    combates: 0,
    vitorias: 0,
    engasgos: 0,
    reparos: 0,
    falencia: false,
    up: {} as Record<string, number>,
    margens: [] as number[],
    tier_final: START_TIER,
  };

  const avgCond = (): number =>
    parts.reduce((sum, p) => sum + p.condition, 0) / Math.max(1, parts.length);

  for (let attempt = 0; attempt < cfg.n_missoes_max; attempt += 1) {
    let integrity = 100;
    const cond = avgCond();
    if (cond <= cfg.reparo_limiar && creditos > 0) {
      const custo =
        roundHalfEven(
          f.preco *
            ((100 - cond) / 100) *
            rules.economy.repair_factor *
            (cfg.preco_reparo / rules.economy.repair_price_ref),
        ) +
        tier * cfg.manutencao_tier;
      if (creditos >= custo) {
        creditos -= custo;
        parts = parts.map((p) => ({ ...p, condition: 100 }));
        m.reparos += 1;
      }
    }

    // Deterministic route stand-in: use rng draws in the same shape as uma_vida
    // (pick a route index via int, then env via pick) so the stream is stable.
    const routeIdx = rng.int(0, 20);
    const danger = routeIdx % 11;
    const distance = 300 + (routeIdx % 8) * 100;
    const envNivel = envNivels[rng.int(0, envNivels.length - 1)]!;
    const fuelMult = envNivel >= 1.5 && envNivel <= 1.5 ? 1.5 : envNivel >= 2.5 ? 1.1 : 1.0;

    const pf = performance(cond);
    const fuelGasto = roundHalfEven((f.fuelUse * distance * fuelMult) / 100);
    if (fuelGasto > fuelMax * 1.5) continue;

    if (cond < cfg.engasgo_inicio) {
      const ch = chokeChance(cond, rules);
      if (rng.float() < ch) {
        m.engasgos += 1;
        creditos -= Math.floor((fuelGasto * cfg.preco_fuel) / 5);
        parts = parts.map((p) => ({
          ...p,
          condition: applyWear(
            p.condition,
            rng.uniform(rules.wear.choke_loss_min, rules.wear.choke_loss_max),
          ),
        }));
        continue;
      }
    }

    const antes = creditos;
    // Production payout: base × integrity (D13), not sim's pf factor.
    const base = rewardBase(
      {
        tier,
        danger,
        distance,
        missionType: 'delivery',
      },
      rules,
    );

    if (rng.float() < danger / rules.encounter.chance_divisor) {
      m.combates += 1;
      // Pirate anchors to the nominal design sheet; the player fights at the
      // effective hull HP (`effectiveSheet`: hp × performance) — the validated
      // sweep construction that yielded the ~55% winrate (S5.7 / sim `uma_vida`).
      const nominalSheet: CombatSheet = {
        pdf: f.PDF,
        bli: f.BLI,
        esc: f.ESC,
        sen: f.SEN,
        hp: f.HP,
        mob: f.MOB,
      };
      const playerSheet: CombatSheet = { ...nominalSheet, hp: f.HP * pf };
      const pirate = generatePirate(nominalSheet, rules, rng.child('pirate'));
      const result = resolveCombat(playerSheet, pirate, rules.combat, rng.child('combat'));
      const hpBefore = playerSheet.hp;
      const finalHp =
        result.outcome === 'A'
          ? result.final.hpA
          : result.outcome === 'B'
            ? result.final.hpB
            : hpBefore;
      const hpLost = Math.max(0, hpBefore - finalHp);
      // Object integrity takes combat damage (D13 / Appendix E).
      integrity = Math.max(
        0,
        integrity - rules.integrity.combat_factor * (hpLost / Math.max(1, hpBefore)) * 100,
      );

      if (result.outcome === 'A') {
        m.vitorias += 1;
        creditos += rules.economy.combat_win_base + tier * rules.economy.combat_win_per_tier;
      } else if (result.outcome === 'B') {
        creditos -= rules.economy.combat_loss_penalty;
        const loss = defeatWear(rules, rng.child('defeat'));
        parts = parts.map((p) => ({ ...p, condition: applyWear(p.condition, loss) }));
      }
    }

    // Environment integrity (per leg).
    integrity = Math.max(0, integrity - rules.integrity.env_factor * envNivel);

    const payout = integrityPayout(base, integrity, rules);
    creditos += payout - roundHalfEven(fuelGasto * cfg.preco_fuel);

    // Per-part mission wear (all_stats): one uniform draw per part.
    parts = parts.map((p) => {
      const { total } = missionWear(envNivel, rules, rng.child(`wear:${p.id}`));
      return { ...p, condition: applyWear(p.condition, total) };
    });

    m.missoes += 1;
    m.margens.push(creditos - antes);

    const prox = tier + 1;
    const upgradeCost = cfg.custos_upgrade[String(prox)];
    if (upgradeCost !== undefined && creditos >= upgradeCost) {
      creditos -= upgradeCost;
      const builds: Record<string, readonly string[]> = {
        carga: [
          'ponte',
          'motor_g',
          'tanque',
          'bateria',
          'carga',
          'carga',
          'carga',
          'casco',
          'canhao',
        ],
        combate: [
          'ponte',
          'motor_g',
          'tanque',
          'bateria',
          'placa',
          'laser',
          'canhao',
          'radar',
          'casco',
        ],
        minerador: [
          'ponte',
          'motor_g',
          'tanque',
          'bateria',
          'minerador',
          'carga',
          'carga',
          'casco',
        ],
        rapido: [
          'ponte',
          'motor_g',
          'motor_p',
          'tanque',
          'bateria',
          'canhao',
          'canhao',
          'casco',
          'radar',
        ],
      };
      build = [...builds[foco]!];
      f = ficha(build);
      fuelMax = f.fuel || fuelMax;
      parts = parts.map((p) => ({ ...p, condition: POST_UPGRADE_CONDITION }));
      tier = prox;
      m.up[String(tier)] = m.missoes;
    }

    if (creditos < BANKRUPTCY_FLOOR) {
      m.falencia = true;
      break;
    }
  }

  m.tier_final = tier;
  return {
    final: { cond: avgCond(), creditos, tier },
    metrics: m,
  };
}

describe('S5.10 Layer 4 — production-mode health bands', () => {
  it('stays inside the recorded layer4 bands with per-part wear and integrity payout', () => {
    const lifeFixture = loadLifeTapes();
    const configs = configsFromTapes(lifeFixture);
    expect(configs).toHaveLength(3);

    const layer4 = baselines.layer4;
    const band = layer4.band;
    // The recorded first-green baseline must itself sit inside the band.
    for (const metric of Object.keys(band) as (keyof Layer4Band)[]) {
      const [lo, hi] = band[metric];
      const value = layer4.baseline[metric];
      expect(value).toBeGreaterThanOrEqual(lo);
      expect(value).toBeLessThanOrEqual(hi);
    }

    // CI-friendly slice (full 2000×3 is Layer 3); sample size is pinned by
    // baselines.layer4.n_lives_per_config.
    const nLives = layer4.n_lives_per_config;
    const results: UmaVidaResult[] = [];
    for (let ci = 0; ci < configs.length; ci += 1) {
      const cfg = configs[ci]!;
      for (let life = 0; life < nLives; life += 1) {
        const seed = 42_000 + ci * 1_000_000 + life;
        results.push(productionVida(cfg.values, createRng(seed)));
      }
    }
    const agg = aggregateLives(results);

    expect(agg.n).toBe(nLives * configs.length);
    expect(agg.falenciaPct).toBeGreaterThanOrEqual(band.falencia_pct[0]);
    expect(agg.falenciaPct).toBeLessThanOrEqual(band.falencia_pct[1]);
    expect(agg.combatWinrate).toBeGreaterThanOrEqual(band.combat_winrate[0]);
    expect(agg.combatWinrate).toBeLessThanOrEqual(band.combat_winrate[1]);
    expect(agg.tier5Pct).toBeGreaterThanOrEqual(band.tier5_pct[0]);
    expect(agg.tier5Pct).toBeLessThanOrEqual(band.tier5_pct[1]);
    expect(agg.missionsTier2Median).toBeGreaterThanOrEqual(band.missions_tier2_median[0]);
    expect(agg.missionsTier2Median).toBeLessThanOrEqual(band.missions_tier2_median[1]);
    expect(agg.missionsTier5Median).toBeGreaterThanOrEqual(band.missions_tier5_median[0]);
    expect(agg.missionsTier5Median).toBeLessThanOrEqual(band.missions_tier5_median[1]);
    expect(agg.engasgoPct).toBeGreaterThanOrEqual(band.engasgo_pct[0]);
    expect(agg.engasgoPct).toBeLessThanOrEqual(band.engasgo_pct[1]);
    expect(agg.medianMargin).toBeGreaterThanOrEqual(band.median_margin[0]);
    expect(agg.medianMargin).toBeLessThanOrEqual(band.median_margin[1]);
  }, 300_000);

  it('documents the layer4 baseline note from baselines.json', () => {
    expect(baselines.layer4.note).toContain('production-mode.spec.ts');
  });
});

// Silence unused import warnings for types used only in signatures.
export type { Ficha };
