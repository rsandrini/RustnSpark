/**
 * Layer 1 / Layer 3 tournament harness — port of
 * `simulation/torneio-balanceamento.py` (S5.10).
 *
 * Layer 1: replay the 600 recorded tapes through `resolveCombat`.
 * Layer 3: statistical winrates with the production PRNG and canonical dials.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScriptedRng, type TapeEntry, type TapeSource } from '../../src/common/rng/scripted.rng.js';
import { createRng } from '../../src/common/rng/rng.js';
import { GAME_CONFIG_DEFAULTS } from '../../src/config/game-config.defaults.js';
import type { GameRules } from '../../src/config/game-config.types.js';
import { resolveCombat } from '../../src/resolution/combat/combat.resolver.js';
import type { CombatOutcome, CombatSheet } from '../../src/resolution/combat/combat.types.js';

const oracleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/oracle');

export interface Ficha {
  PDF: number;
  BLI: number;
  ESC: number;
  SEN: number;
  HP: number;
  MOB: number;
  mass: number;
  pot: number;
}

export interface CombatTape {
  entries: TapeEntry[];
  fichas: { A: Ficha; B: Ficha };
  final: { hpA: number; hpB: number; escA: number; escB: number };
  outcome: 'A' | 'B' | 'e';
  order: 'AB' | 'BA';
  seed: number;
  slot_a: string;
  slot_b: string;
  rep: number;
}

export interface CombatTapesFixture {
  dials: {
    esquiva: number;
    bli_teto: number;
    fura: number;
    esc_regen: number;
    kite: number;
  };
  seqs: TapeSource['seqs'];
  tapes: CombatTape[];
}

export function loadCombatTapes(): CombatTapesFixture {
  return JSON.parse(
    readFileSync(path.join(oracleDir, 'combat-tapes.json'), 'utf8'),
  ) as CombatTapesFixture;
}

/** Torneio dials + Layer-1 overrides (no first strike, 50 rounds, recorded fura). */
export function torneioRules(fixture: CombatTapesFixture): GameRules['combat'] {
  return {
    ...GAME_CONFIG_DEFAULTS.combat,
    dodge_factor: fixture.dials.esquiva,
    armor_cap: fixture.dials.bli_teto,
    pierce_ratio: fixture.dials.fura,
    shield_regen: fixture.dials.esc_regen,
    armor_pool_factor: 5,
    kite_factor: fixture.dials.kite,
    first_strike_bonus: 0,
    max_rounds: 50,
    retreat_hp_ratio: 0.2,
  };
}

/** Canonical Layer-3 dials (baselines.json: first_strike 2, max_rounds 40, pierce 0.35). */
export function canonicalRules(): GameRules['combat'] {
  return { ...GAME_CONFIG_DEFAULTS.combat };
}

export function toSheet(f: Ficha): CombatSheet {
  return { pdf: f.PDF, bli: f.BLI, esc: f.ESC, sen: f.SEN, hp: f.HP, mob: f.MOB };
}

export function mapOutcome(o: 'A' | 'B' | 'e'): CombatOutcome {
  return o === 'e' ? 'draw' : o;
}

/** Replays one Layer-1 tape; throws on outcome / final / RNG mismatch. */
export function replayTape(
  tape: CombatTape,
  fixture: CombatTapesFixture,
  rules: GameRules['combat'],
): void {
  const rng = new ScriptedRng(tape.entries, fixture.seqs, `combat seed ${tape.seed}`);
  const result = resolveCombat(toSheet(tape.fichas.A), toSheet(tape.fichas.B), rules, rng);
  const label = `${tape.slot_a} vs ${tape.slot_b} ${tape.order} rep ${tape.rep} seed ${tape.seed}`;
  if (result.outcome !== mapOutcome(tape.outcome)) {
    throw new Error(`${label}: outcome ${result.outcome} !== ${tape.outcome}`);
  }
  const expected = {
    hpA: tape.final.hpA,
    hpB: tape.final.hpB,
    escA: tape.final.escA,
    escB: tape.final.escB,
  };
  if (
    result.final.hpA !== expected.hpA ||
    result.final.hpB !== expected.hpB ||
    result.final.escA !== expected.escA ||
    result.final.escB !== expected.escB
  ) {
    throw new Error(
      `${label}: final ${JSON.stringify(result.final)} !== ${JSON.stringify(expected)}`,
    );
  }
  rng.assertDrained();
}

/** Tournament build names in Python definition order (not JSON key order). */
export const TORNEIO_BUILD_ORDER = ['Rapido', 'Blindado', 'DanoAlto', 'Escudo', 'Equilib'] as const;

export interface TournamentBuildSheets {
  readonly [name: string]: CombatSheet;
}

/** Sheets for the 5 torneio builds, keyed by name (from the tape fixture's first encounters). */
export function buildSheetsFromTapes(fixture: CombatTapesFixture): TournamentBuildSheets {
  const sheets: Record<string, CombatSheet> = {};
  for (const tape of fixture.tapes) {
    if (sheets[tape.slot_a] === undefined) {
      sheets[tape.slot_a] = toSheet(tape.fichas.A);
    }
    if (sheets[tape.slot_b] === undefined) {
      sheets[tape.slot_b] = toSheet(tape.fichas.B);
    }
  }
  return sheets;
}

export interface TournamentResult {
  readonly winrates: Readonly<Record<string, number>>;
  readonly spread: number;
}

/**
 * Fixed-order tournament (sim `avaliar`): each unordered pair once, A = first
 * name in definition order. Draws count as games, no wins.
 */
export function tournamentFixedOrder(
  sheets: TournamentBuildSheets,
  names: readonly string[],
  nPerPair: number,
  rules: GameRules['combat'],
  seed: string | number,
): TournamentResult {
  const wins: Record<string, number> = {};
  const games: Record<string, number> = {};
  for (const name of names) {
    wins[name] = 0;
    games[name] = 0;
  }
  let pairIndex = 0;
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = names[i]!;
      const b = names[j]!;
      const sheetA = sheets[a]!;
      const sheetB = sheets[b]!;
      for (let rep = 0; rep < nPerPair; rep += 1) {
        const rng = createRng(`${seed}:fixed:${pairIndex}:${rep}`);
        const result = resolveCombat(sheetA, sheetB, rules, rng);
        games[a] = (games[a] ?? 0) + 1;
        games[b] = (games[b] ?? 0) + 1;
        if (result.outcome === 'A') {
          wins[a] = (wins[a] ?? 0) + 1;
        } else if (result.outcome === 'B') {
          wins[b] = (wins[b] ?? 0) + 1;
        }
      }
      pairIndex += 1;
    }
  }
  const winrates: Record<string, number> = {};
  for (const name of names) {
    winrates[name] = (wins[name]! / Math.max(1, games[name]!)) * 100;
  }
  const values = Object.values(winrates);
  return { winrates, spread: Math.max(...values) - Math.min(...values) };
}

/**
 * Symmetrized tournament: each ordered pair (A,B) and (B,A) with independent
 * draws — D16c / Layer-3 band (oracle spread 13.3–14.0).
 */
export function tournamentSymmetrized(
  sheets: TournamentBuildSheets,
  names: readonly string[],
  nPerOrder: number,
  rules: GameRules['combat'],
  seed: string | number,
): TournamentResult {
  const wins: Record<string, number> = {};
  const games: Record<string, number> = {};
  for (const name of names) {
    wins[name] = 0;
    games[name] = 0;
  }
  let pairIndex = 0;
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = names[i]!;
      const b = names[j]!;
      const pairs: readonly [string, string][] = [
        [a, b],
        [b, a],
      ];
      for (const [left, right] of pairs) {
        const sheetLeft = sheets[left]!;
        const sheetRight = sheets[right]!;
        for (let rep = 0; rep < nPerOrder; rep += 1) {
          const rng = createRng(`${seed}:sym:${pairIndex}:${rep}`);
          const result = resolveCombat(sheetLeft, sheetRight, rules, rng);
          games[left] = (games[left] ?? 0) + 1;
          games[right] = (games[right] ?? 0) + 1;
          if (result.outcome === 'A') {
            wins[left] = (wins[left] ?? 0) + 1;
          } else if (result.outcome === 'B') {
            wins[right] = (wins[right] ?? 0) + 1;
          }
        }
        pairIndex += 1;
      }
      pairIndex += 1;
    }
  }
  const winrates: Record<string, number> = {};
  for (const name of names) {
    winrates[name] = (wins[name]! / Math.max(1, games[name]!)) * 100;
  }
  const values = Object.values(winrates);
  return { winrates, spread: Math.max(...values) - Math.min(...values) };
}
