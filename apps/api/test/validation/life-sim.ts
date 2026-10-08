/**
 * Layer 2 life harness — exact port of `uma_vida` / `gerar_mapa` from
 * `simulation/sweep-rust-and-spark.py` (S5.10).
 *
 * Test-only constants (300-mission cap, 90% post-upgrade condition, choke
 * penalty `//5`) live here, not in `GameConfig` (plan S5.10).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScriptedRng, type TapeEntry, type TapeSource } from '../../src/common/rng/scripted.rng.js';
import { createRng, type Rng } from '../../src/common/rng/rng.js';
import { roundHalfEven } from '../../src/resolution/numeric/round-half-even.js';
import { resolveCombat } from '../../src/resolution/combat/combat.resolver.js';
import type { CombatSheet } from '../../src/resolution/combat/combat.types.js';

const oracleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/oracle');

// ---------------------------------------------------------------------------
// Catalog (sweep PECAS / AMBIENTES / builds) — test-only, not GameConfig.
// ---------------------------------------------------------------------------

interface Peca {
  mass?: number;
  HP?: number;
  pot?: number;
  PDF?: number;
  BLI?: number;
  ESC?: number;
  SEN?: number;
  CRG?: number;
  MIN?: number;
  preco?: number;
  fuelUse?: number;
  fuel?: number;
}

const PECAS: Readonly<Record<string, Peca>> = {
  ponte: { mass: 4, HP: 30, preco: 0 },
  motor_g: { mass: 14, pot: 70, fuelUse: 2.5, preco: 800 },
  motor_p: { mass: 3, pot: 25, fuelUse: 0.7, preco: 100 },
  bateria: { mass: 5, preco: 150 },
  tanque: { mass: 5, fuel: 1000, preco: 200 },
  canhao: { mass: 3, PDF: 3, preco: 120 },
  laser: { mass: 4, PDF: 4, preco: 350 },
  missil: { mass: 6, PDF: 8, preco: 450 },
  placa: { mass: 10, BLI: 4, HP: 40, preco: 500 },
  casco: { mass: 4, BLI: 1, HP: 20, preco: 100 },
  escudo: { mass: 4, ESC: 14, preco: 400 },
  radar: { mass: 2, SEN: 4, preco: 200 },
  carga: { mass: 2, CRG: 5, preco: 80 },
  minerador: { mass: 8, MIN: 1, preco: 400 },
};

/** Environment ids in Python dict-insertion order (tape seq 0). */
export const AMBIENTE_IDS = ['aberto', 'radiacao', 'detritos', 'gravitacional'] as const;

const AMBIENTES: Readonly<Record<string, { nivel: number; fuel_mult: number }>> = {
  aberto: { nivel: 0.5, fuel_mult: 1.0 },
  radiacao: { nivel: 2.0, fuel_mult: 1.0 },
  detritos: { nivel: 2.5, fuel_mult: 1.1 },
  gravitacional: { nivel: 1.5, fuel_mult: 1.5 },
};

/** Upgrade build ids in Python dict-insertion order (tape seq 1). */
export const FOCO_IDS = ['carga', 'combate', 'minerador', 'rapido'] as const;

const BUILDS_UPGRADE: Readonly<Record<string, readonly string[]>> = {
  carga: ['ponte', 'motor_g', 'tanque', 'bateria', 'carga', 'carga', 'carga', 'casco', 'canhao'],
  combate: ['ponte', 'motor_g', 'tanque', 'bateria', 'placa', 'laser', 'canhao', 'radar', 'casco'],
  minerador: ['ponte', 'motor_g', 'tanque', 'bateria', 'minerador', 'carga', 'carga', 'casco'],
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

const BUILD_INICIAL = ['ponte', 'motor_p', 'tanque', 'bateria', 'carga', 'carga', 'casco'] as const;

/** Sweep combat dials (CB) — not GameConfig (torneio confirmed these). */
const CB = {
  esquiva: 1.5,
  bli_teto: 4,
  fura: 0.35,
  esc_regen: 2,
  kite: 0.2,
  inic: 2,
  max_rounds: 40,
  retreat_hp_ratio: 0.2,
} as const;

const MOB_FACTOR = 1.6;
const MIN_MOB = 1;

// Test-only life constants (plan S5.10 — not GameConfig).
const START_CREDITS = 200;
const START_TIER = 1;
const FUEL_FALLBACK = 1000;
const POST_UPGRADE_CONDITION = 90;
const BANKRUPTCY_FLOOR = -200;
const REPAIR_FACTOR = 0.8;
const REPAIR_PRICE_REF = 4;
const CHOKE_LOSS_MIN = 3;
const CHOKE_LOSS_MAX = 8;
const DEFEAT_LOSS_MIN = 8;
const DEFEAT_LOSS_MAX = 15;
const COMBAT_WIN_BASE = 100;
const COMBAT_WIN_PER_TIER = 50;
const COMBAT_LOSS_PENALTY = 120;
const DANGER_CHOKE_DIVISOR = 15;
const DANGER_ENCOUNTER_DIVISOR = 20;
const DISTANCE_REF = 800;
const DISTANCE_DIVISOR = 3000;
const WEAR_BASE_MIN = 3;
const WEAR_BASE_MAX = 5;
const WEAR_ENV_MULTIPLIER = 1.2;
const NODE_COUNT = 12;
const ROUTE_SPAN = 2;
const DIST_BASE = 300;
const DIST_STEP = 400;
const DIST_JITTER_MAX = 300;
const DANGER_JITTER_MAX = 2;
const PIRATE_MIN_PDF = 2;
const PIRATE_MIN_HP = 30;
const PIRATE_BLI_RATIO = 0.6;
const PIRATE_STRENGTHS = [0.55, 0.7, 0.8, 0.85, 1.0, 1.1] as const;
const JITTER = [-1, 0, 1] as const;

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

export interface UmaVidaConfig {
  readonly custos_upgrade: Readonly<Record<string, number>>;
  readonly desg_ambiente: number;
  readonly desg_base: readonly [number, number];
  readonly engasgo_inicio: number;
  readonly manutencao_tier: number;
  readonly n_missoes_max: number;
  readonly peca_inicial_cond: number;
  readonly preco_fuel: number;
  readonly preco_reparo: number;
  readonly rec_base: number;
  readonly rec_por_tier: number;
  readonly reparo_limiar: number;
}

export interface UmaVidaMetrics {
  missoes: number;
  combates: number;
  vitorias: number;
  engasgos: number;
  reparos: number;
  falencia: boolean;
  up: Record<string, number>;
  margens: number[];
  tier_final: number;
}

export interface UmaVidaFinal {
  cond: number;
  creditos: number;
  tier: number;
}

export interface LifeTape {
  config: string;
  config_values: UmaVidaConfig;
  entries: TapeEntry[];
  final: UmaVidaFinal;
  life_index: number;
  metrics: UmaVidaMetrics;
  seed: number;
}

export interface LifeTapesFixture {
  configs: string[];
  seqs: TapeSource['seqs'];
  lives: LifeTape[];
  version: number;
}

export function loadLifeTapes(): LifeTapesFixture {
  return JSON.parse(
    readFileSync(path.join(oracleDir, 'life-tapes.json'), 'utf8'),
  ) as LifeTapesFixture;
}

// ---------------------------------------------------------------------------
// ficha / combat helpers
// ---------------------------------------------------------------------------

export interface Ficha {
  pot: number;
  mass: number;
  PDF: number;
  BLI: number;
  ESC: number;
  SEN: number;
  HP: number;
  preco: number;
  fuelUse: number;
  fuel: number;
  MOB: number;
}

export function ficha(lista: readonly string[]): Ficha {
  const f: Ficha = {
    pot: 0,
    mass: 0,
    PDF: 0,
    BLI: 0,
    ESC: 0,
    SEN: 0,
    HP: 0,
    preco: 0,
    fuelUse: 0,
    fuel: 0,
    MOB: MIN_MOB,
  };
  for (const id of lista) {
    const p = PECAS[id];
    if (p === undefined) continue;
    f.pot += p.pot ?? 0;
    f.mass += p.mass ?? 0;
    f.PDF += p.PDF ?? 0;
    f.BLI += p.BLI ?? 0;
    f.ESC += p.ESC ?? 0;
    f.SEN += p.SEN ?? 0;
    f.HP += p.HP ?? 0;
    f.preco += p.preco ?? 0;
    f.fuelUse += p.fuelUse ?? 0;
    f.fuel += p.fuel ?? 0;
  }
  f.MOB = f.mass > 0 ? Math.max(MIN_MOB, roundHalfEven((f.pot / f.mass) * MOB_FACTOR)) : MIN_MOB;
  return f;
}

export function performance(condition: number): number {
  return 0.5 + 0.5 * (Math.max(0, condition) / 100);
}

function toCombatSheet(f: Ficha, hpOverride?: number): CombatSheet {
  return {
    pdf: f.PDF,
    bli: f.BLI,
    esc: f.ESC,
    sen: f.SEN,
    hp: hpOverride ?? f.HP,
    mob: f.MOB,
  };
}

/** Sweep combate dials → resolveCombat rules (first strike = inic, 40 rounds). */
function sweepCombatRules() {
  return {
    dodge_factor: CB.esquiva,
    armor_cap: CB.bli_teto,
    pierce_ratio: CB.fura,
    shield_regen: CB.esc_regen,
    armor_pool_factor: 5,
    kite_factor: CB.kite,
    first_strike_bonus: CB.inic,
    max_rounds: CB.max_rounds,
    retreat_hp_ratio: CB.retreat_hp_ratio,
    attack_die: 20,
    damage_die: 6,
    dc_base: 10,
    pierce_min_pdf: 8,
  } as const;
}

/**
 * Sweep combate: A = player (vitoria/derrota/empate). Player HP may be a
 * float (HP × performance) — resolveCombat accepts that.
 */
function combate(nav: Ficha, ini: Ficha, rng: Rng): 'vitoria' | 'derrota' | 'empate' {
  const result = resolveCombat(toCombatSheet(nav), toCombatSheet(ini), sweepCombatRules(), rng);
  if (result.outcome === 'A') return 'vitoria';
  if (result.outcome === 'B') return 'derrota';
  return 'empate';
}

// ---------------------------------------------------------------------------
// gerar_mapa / uma_vida
// ---------------------------------------------------------------------------

export interface SimRoute {
  dist: number;
  perigo: number;
  amb: string;
}

export function gerarMapa(rng: Rng): SimRoute[] {
  const nos: { id: number; zona: number; perigo: number }[] = [];
  for (let i = 0; i < NODE_COUNT; i += 1) {
    const zona = Math.min(3, Math.floor(i / 3));
    nos.push({ id: i, zona, perigo: zona * 2 + rng.int(0, DANGER_JITTER_MAX) });
  }
  const rotas: SimRoute[] = [];
  for (let a = 0; a < NODE_COUNT; a += 1) {
    for (let b = a + 1; b < Math.min(a + 1 + ROUTE_SPAN, NODE_COUNT); b += 1) {
      const dist = DIST_BASE + Math.abs(a - b) * DIST_STEP + rng.int(0, DIST_JITTER_MAX);
      const maxZona = Math.max(nos[a]!.zona, nos[b]!.zona);
      const amb = maxZona > 0 ? (rng.pick(AMBIENTE_IDS) as string) : 'aberto';
      rotas.push({
        dist,
        perigo: Math.max(nos[a]!.perigo, nos[b]!.perigo),
        amb,
      });
    }
  }
  return rotas;
}

export interface UmaVidaResult {
  readonly final: UmaVidaFinal;
  readonly metrics: UmaVidaMetrics;
}

/**
 * Exact `uma_vida(cfg)` port. `rng` is a ScriptedRng for Layer 2 (flat tape)
 * or createRng-derived for Layer 3. All RNG order matches the sweep.
 */
export function umaVida(cfg: UmaVidaConfig, rng: Rng): UmaVidaResult {
  const rotas = gerarMapa(rng);
  let build: readonly string[] = [...BUILD_INICIAL];
  let cond = cfg.peca_inicial_cond;
  let f = ficha(build);
  let creditos = START_CREDITS;
  let tier = START_TIER;
  let fuelMax = f.fuel || FUEL_FALLBACK;
  const foco = rng.pick(FOCO_IDS) as string;
  const m: UmaVidaMetrics = {
    missoes: 0,
    combates: 0,
    vitorias: 0,
    engasgos: 0,
    reparos: 0,
    falencia: false,
    up: {},
    margens: [],
    tier_final: START_TIER,
  };

  for (let attempt = 0; attempt < cfg.n_missoes_max; attempt += 1) {
    if (cond <= cfg.reparo_limiar && creditos > 0) {
      const custo =
        roundHalfEven(
          f.preco * ((100 - cond) / 100) * REPAIR_FACTOR * (cfg.preco_reparo / REPAIR_PRICE_REF),
        ) +
        tier * cfg.manutencao_tier;
      if (creditos >= custo) {
        creditos -= custo;
        cond = 100;
        m.reparos += 1;
      }
    }

    const rota = rng.pick(rotas);
    const D = rota.dist;
    const perigo = rota.perigo;
    const amb = AMBIENTES[rota.amb]!;
    const pf = performance(cond);
    const fuelGasto = roundHalfEven((f.fuelUse * D * amb.fuel_mult) / 100);
    if (fuelGasto > fuelMax * 1.5) {
      continue;
    }

    if (cond < cfg.engasgo_inicio) {
      const ch = ((cfg.engasgo_inicio - cond) / cfg.engasgo_inicio) ** 2;
      if (rng.float() < ch) {
        m.engasgos += 1;
        creditos -= Math.floor((fuelGasto * cfg.preco_fuel) / 5);
        cond = Math.max(0, cond - rng.uniform(CHOKE_LOSS_MIN, CHOKE_LOSS_MAX));
        continue;
      }
    }

    const antes = creditos;
    const rec = roundHalfEven(
      (cfg.rec_base + tier * cfg.rec_por_tier) *
        pf *
        (1 + perigo / DANGER_CHOKE_DIVISOR) *
        (1 + (D - DISTANCE_REF) / DISTANCE_DIVISOR),
    );

    if (rng.float() < perigo / DANGER_ENCOUNTER_DIVISOR) {
      m.combates += 1;
      const strength = rng.pick(PIRATE_STRENGTHS);
      const mobJitter = rng.pick(JITTER);
      const senJitter = rng.pick(JITTER);
      const ini: Ficha = {
        pot: 0,
        mass: 0,
        PDF: Math.max(PIRATE_MIN_PDF, roundHalfEven(f.PDF * strength)),
        BLI: Math.max(0, roundHalfEven(f.BLI * strength * PIRATE_BLI_RATIO)),
        ESC: 0,
        SEN: Math.max(0, f.SEN + senJitter),
        HP: Math.max(PIRATE_MIN_HP, roundHalfEven(f.HP * strength)),
        preco: 0,
        fuelUse: 0,
        fuel: 0,
        MOB: Math.max(MIN_MOB, f.MOB + mobJitter),
      };
      const nav: Ficha = { ...f, HP: f.HP * pf };
      const r = combate(nav, ini, rng);
      if (r === 'vitoria') {
        m.vitorias += 1;
        creditos += COMBAT_WIN_BASE + tier * COMBAT_WIN_PER_TIER;
      } else if (r === 'derrota') {
        creditos -= COMBAT_LOSS_PENALTY;
        cond = Math.max(0, cond - rng.uniform(DEFEAT_LOSS_MIN, DEFEAT_LOSS_MAX));
      }
    }

    creditos += rec - roundHalfEven(fuelGasto * cfg.preco_fuel);
    const desg = rng.uniform(WEAR_BASE_MIN, WEAR_BASE_MAX) + amb.nivel * WEAR_ENV_MULTIPLIER;
    cond = Math.max(0, cond - desg);
    m.missoes += 1;
    m.margens.push(creditos - antes);

    const prox = tier + 1;
    const upgradeCost = cfg.custos_upgrade[String(prox)];
    if (upgradeCost !== undefined && creditos >= upgradeCost) {
      creditos -= upgradeCost;
      build = [...BUILDS_UPGRADE[foco]!];
      f = ficha(build);
      fuelMax = f.fuel || fuelMax;
      cond = POST_UPGRADE_CONDITION;
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
    final: { cond, creditos, tier },
    metrics: m,
  };
}

/** Replays one life tape end-to-end; throws on any mismatch. */
export function replayLife(life: LifeTape, fixture: LifeTapesFixture): void {
  const rng = new ScriptedRng(life.entries, fixture.seqs, `life seed ${life.seed}`);
  const result = umaVida(life.config_values, rng);
  const label = `life ${life.seed} ${life.config}`;
  if (result.final.creditos !== life.final.creditos) {
    throw new Error(`${label}: creditos ${result.final.creditos} !== ${life.final.creditos}`);
  }
  if (result.final.tier !== life.final.tier) {
    throw new Error(`${label}: tier ${result.final.tier} !== ${life.final.tier}`);
  }
  if (result.metrics.missoes !== life.metrics.missoes) {
    throw new Error(`${label}: missoes ${result.metrics.missoes} !== ${life.metrics.missoes}`);
  }
  if (result.metrics.engasgos !== life.metrics.engasgos) {
    throw new Error(`${label}: engasgos ${result.metrics.engasgos} !== ${life.metrics.engasgos}`);
  }
  if (result.metrics.combates !== life.metrics.combates) {
    throw new Error(`${label}: combates ${result.metrics.combates} !== ${life.metrics.combates}`);
  }
  if (result.metrics.vitorias !== life.metrics.vitorias) {
    throw new Error(`${label}: vitorias ${result.metrics.vitorias} !== ${life.metrics.vitorias}`);
  }
  if (result.metrics.reparos !== life.metrics.reparos) {
    throw new Error(`${label}: reparos ${result.metrics.reparos} !== ${life.metrics.reparos}`);
  }
  if (result.metrics.falencia !== life.metrics.falencia) {
    throw new Error(`${label}: falencia ${result.metrics.falencia} !== ${life.metrics.falencia}`);
  }
  if (result.final.cond !== life.final.cond) {
    throw new Error(`${label}: cond ${result.final.cond} !== ${life.final.cond}`);
  }
  rng.assertDrained();
}

// ---------------------------------------------------------------------------
// Aggregation (Layer 3 / Layer 4 health metrics)
// ---------------------------------------------------------------------------

export interface LifeAggregate {
  readonly n: number;
  readonly falenciaPct: number;
  readonly combatWinrate: number;
  readonly tier5Pct: number;
  readonly missionsTier2Median: number;
  readonly missionsTier5Median: number;
  readonly engasgoPct: number;
  readonly medianMargin: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Sweep `avaliar_cfg` aggregation over a batch of lives. */
export function aggregateLives(results: readonly UmaVidaResult[]): LifeAggregate {
  const n = results.length;
  if (n === 0) {
    return {
      n: 0,
      falenciaPct: 0,
      combatWinrate: 0,
      tier5Pct: 0,
      missionsTier2Median: 0,
      missionsTier5Median: 0,
      engasgoPct: 0,
      medianMargin: 0,
    };
  }
  const falencia = results.filter((r) => r.metrics.falencia).length;
  let combates = 0;
  let vitorias = 0;
  let tier5 = 0;
  const up2: number[] = [];
  const up5: number[] = [];
  let tm = 0;
  let te = 0;
  const margins: number[] = [];
  for (const r of results) {
    combates += r.metrics.combates;
    vitorias += r.metrics.vitorias;
    if (r.metrics.tier_final >= 5) tier5 += 1;
    if (r.metrics.up['2'] !== undefined) up2.push(r.metrics.up['2']);
    if (r.metrics.up['5'] !== undefined) up5.push(r.metrics.up['5']);
    tm += r.metrics.missoes;
    te += r.metrics.engasgos;
    margins.push(...r.metrics.margens);
  }
  return {
    n,
    falenciaPct: (falencia / n) * 100,
    combatWinrate: (vitorias / Math.max(1, combates)) * 100,
    tier5Pct: (tier5 / n) * 100,
    missionsTier2Median: up2.length > 0 ? median(up2) : 999,
    missionsTier5Median: up5.length > 0 ? median(up5) : 999,
    engasgoPct: (te / Math.max(1, tm + te)) * 100,
    medianMargin: median(margins),
  };
}

/**
 * Runs `nLives` lives per config with independent production PRNG seeds.
 * Config overrides come from the focused grade (life-tapes config_values).
 */
export function runLifeSweep(
  configs: readonly { name: string; values: UmaVidaConfig }[],
  nLives: number,
  baseSeed: number,
): { name: string; aggregate: LifeAggregate }[] {
  return configs.map((cfg, ci) => {
    const results: UmaVidaResult[] = [];
    for (let life = 0; life < nLives; life += 1) {
      const seed = baseSeed + ci * 1_000_000 + life;
      results.push(umaVida(cfg.values, new SeededFlatRng(seed)));
    }
    return { name: cfg.name, aggregate: aggregateLives(results) };
  });
}

/**
 * Independent flat RNG for Layer-3 lives: `uma_vida` never calls `child`, so
 * a plain createRng wrapper is enough. ScriptedRng is only for tapes.
 */
class SeededFlatRng implements Rng {
  private readonly inner: Rng;
  constructor(seed: number) {
    this.inner = createRng(seed);
  }
  float(): number {
    return this.inner.float();
  }
  int(min: number, max: number): number {
    return this.inner.int(min, max);
  }
  uniform(min: number, max: number): number {
    return this.inner.uniform(min, max);
  }
  pick<T>(items: readonly T[]): T {
    return this.inner.pick(items);
  }
  child(label: string): Rng {
    return this.inner.child(label);
  }
}

/** Extract unique config_values from the life-tape fixture (3 GDD configs). */
export function configsFromTapes(fixture: LifeTapesFixture): {
  name: string;
  values: UmaVidaConfig;
}[] {
  const seen = new Map<string, UmaVidaConfig>();
  for (const life of fixture.lives) {
    if (!seen.has(life.config)) {
      seen.set(life.config, life.config_values);
    }
  }
  return [...seen.entries()].map(([name, values]) => ({ name, values }));
}
