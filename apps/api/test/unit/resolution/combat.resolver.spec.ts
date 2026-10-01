import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@jest/globals';
import {
  ScriptedRng,
  type TapeEntry,
  type TapeSource,
} from '../../../src/common/rng/scripted.rng.js';
import { createRng, type Rng } from '../../../src/common/rng/rng.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import { resolveCombat } from '../../../src/resolution/combat/combat.resolver.js';
import type { CombatOutcome, CombatSheet } from '../../../src/resolution/combat/combat.types.js';

const oracleDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/oracle',
);

interface Ficha {
  PDF: number;
  BLI: number;
  ESC: number;
  SEN: number;
  HP: number;
  MOB: number;
  mass: number;
  pot: number;
}

interface CombatTape {
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

interface CombatTapesFixture {
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

const fixture = JSON.parse(
  readFileSync(path.join(oracleDir, 'combat-tapes.json'), 'utf8'),
) as CombatTapesFixture;

/** Torneio dials + Layer-1 harness overrides (no first strike, 50 rounds, fura 0.25). */
function torneioRules(): GameRules['combat'] {
  return {
    ...GAME_CONFIG_DEFAULTS.combat,
    dodge_factor: fixture.dials.esquiva,
    armor_cap: fixture.dials.bli_teto,
    pierce_ratio: fixture.dials.fura,
    shield_regen: fixture.dials.esc_regen,
    kite_factor: fixture.dials.kite,
    first_strike_bonus: 0,
    max_rounds: 50,
    retreat_hp_ratio: 0.2,
  };
}

function toSheet(f: Ficha): CombatSheet {
  return { pdf: f.PDF, bli: f.BLI, esc: f.ESC, sen: f.SEN, hp: f.HP, mob: f.MOB };
}

function mapOutcome(o: 'A' | 'B' | 'e'): CombatOutcome {
  return o === 'e' ? 'draw' : o;
}

function countingRng(inner: Rng): { rng: Rng; floats: () => number; ints: () => number } {
  let floatCalls = 0;
  let intCalls = 0;
  const rng: Rng = {
    float(): number {
      floatCalls += 1;
      return inner.float();
    },
    int(min: number, max: number): number {
      intCalls += 1;
      return inner.int(min, max);
    },
    uniform(min: number, max: number): number {
      return inner.uniform(min, max);
    },
    pick<T>(items: readonly T[]): T {
      return inner.pick(items);
    },
    child(label: string): Rng {
      return inner.child(label);
    },
  };
  return {
    rng,
    floats: () => floatCalls,
    ints: () => intCalls,
  };
}

describe('resolveCombat — Layer 1 parity (S5.3)', () => {
  it('replays all 600 torneio tapes: outcome, final HP/shield, drained RNG', () => {
    expect(fixture.tapes).toHaveLength(600);
    const rules = torneioRules();
    for (const tape of fixture.tapes) {
      const rng = new ScriptedRng(tape.entries, fixture.seqs, `combat seed ${tape.seed}`);
      const result = resolveCombat(toSheet(tape.fichas.A), toSheet(tape.fichas.B), rules, rng);
      const label = `${tape.slot_a} vs ${tape.slot_b} ${tape.order} rep ${tape.rep} seed ${tape.seed}`;
      expect({ label, outcome: result.outcome }).toEqual({
        label,
        outcome: mapOutcome(tape.outcome),
      });
      expect({ label, final: result.final }).toEqual({
        label,
        final: {
          hpA: tape.final.hpA,
          hpB: tape.final.hpB,
          escA: tape.final.escA,
          escB: tape.final.escB,
        },
      });
      expect(() => rng.assertDrained()).not.toThrow();
    }
  });

  it('covers all 10 build pairs in both slot orders', () => {
    // slot_a/slot_b already name whoever sits in combat slots A/B for that order.
    const directed = new Set(fixture.tapes.map((t) => `${t.slot_a}|${t.slot_b}`));
    const unordered = new Set(fixture.tapes.map((t) => [t.slot_a, t.slot_b].sort().join('|')));
    expect(unordered.size).toBe(10);
    expect(directed.size).toBe(20);
    const orders = new Set(fixture.tapes.map((t) => t.order));
    expect(orders).toEqual(new Set(['AB', 'BA']));
  });
});

describe('resolveCombat — acceptance (S5.3)', () => {
  const base: GameRules['combat'] = {
    ...GAME_CONFIG_DEFAULTS.combat,
    first_strike_bonus: 0,
    max_rounds: 40,
  };

  it('draws both kite floats every round even when kite_factor is 0', () => {
    const noKite: GameRules['combat'] = { ...base, kite_factor: 0, max_rounds: 5 };
    const { rng, floats, ints } = countingRng(createRng(42));
    // Equal MOB, both above retreat for all 5 rounds (pdf 0 → only d20s).
    const a: CombatSheet = { pdf: 0, bli: 0, esc: 0, sen: 10, hp: 100, mob: 3 };
    const b: CombatSheet = { pdf: 0, bli: 0, esc: 0, sen: 5, hp: 100, mob: 3 };
    resolveCombat(a, b, noKite, rng);
    // Exactly 2 float() per round, even though kite probability is 0.
    expect(floats()).toBe(10);
    // Both sides always attack (no kite): 2 d20s per round, no d6 (never hit past DC).
    expect(ints()).toBeGreaterThanOrEqual(10);
  });

  it('applies first strike only to the first attacker that actually rolls', () => {
    const rules: GameRules['combat'] = {
      ...base,
      first_strike_bonus: 2,
      kite_factor: 1,
      max_rounds: 2,
    };
    // A much faster → aKite always true → B (higher SEN, first in order) is always
    // kited and never rolls; first strike must land on A's first real attack.
    const fastA: CombatSheet = { pdf: 0, bli: 0, esc: 0, sen: 0, hp: 100, mob: 10 };
    const slowB: CombatSheet = { pdf: 0, bli: 0, esc: 0, sen: 10, hp: 100, mob: 1 };
    // A vs B: dc = 10 + roundHalfEven(1×1.5) = 12.
    // Round 1: A roll 10 + 0 + 2 = 12 → hit (d6). Round 2: A roll 10 + 0 = 10 → miss.
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.99 },
        { fn: 'random', args: [], value: 0.99 },
        { fn: 'randint', args: [1, 20], value: 10 },
        { fn: 'randint', args: [1, 6], value: 3 },
        { fn: 'random', args: [], value: 0.99 },
        { fn: 'random', args: [], value: 0.99 },
        { fn: 'randint', args: [1, 20], value: 10 },
      ],
      [],
      'first-strike',
    );
    const result = resolveCombat(fastA, slowB, rules, rng);
    expect(result.rounds.every((e) => e.attacker === 'A')).toBe(true);
    expect(result.rounds[0]?.hit).toBe(true);
    expect(result.rounds[1]?.hit).toBe(false);
    // The report's "roll + bonus = total vs DC" breakdown needs the bonus actually applied on
    // each attack, not just the final hit/miss — round 1 held the pending first-strike bonus,
    // round 2 didn't (already consumed).
    expect(result.rounds[0]?.bonus).toBe(2);
    expect(result.rounds[1]?.bonus).toBe(0);
    rng.assertDrained();
  });

  it("includes each attacker's own firepower in the event, for the report's roll breakdown", () => {
    const rules: GameRules['combat'] = { ...base, kite_factor: 0, max_rounds: 1 };
    const strong: CombatSheet = { pdf: 7, bli: 0, esc: 0, sen: 5, hp: 100, mob: 1 };
    const weak: CombatSheet = { pdf: 3, bli: 0, esc: 0, sen: 1, hp: 100, mob: 1 };
    const result = resolveCombat(strong, weak, rules, createRng(1));
    const byAttacker = (side: 'A' | 'B') => result.rounds.find((e) => e.attacker === side);
    expect(byAttacker('A')?.pdf).toBe(7);
    expect(byAttacker('B')?.pdf).toBe(3);
  });

  it('caps shield regen at the sheet maximum', () => {
    const rules: GameRules['combat'] = { ...base, shield_regen: 10, max_rounds: 3, kite_factor: 0 };
    // High defender MOB → DC > natural max + pdf 0 → never hit; only regen matters.
    const shielded: CombatSheet = { pdf: 0, bli: 0, esc: 10, sen: 20, hp: 100, mob: 20 };
    const peon: CombatSheet = { pdf: 0, bli: 0, esc: 0, sen: 1, hp: 100, mob: 20 };
    const result = resolveCombat(shielded, peon, rules, createRng(7));
    expect(result.final.escA).toBe(10);
    expect(result.final.escB).toBe(0);
    expect(result.rounds.every((e) => !e.hit)).toBe(true);
    expect(result.rounds.every((e) => e.shieldAbsorbed === 0)).toBe(true);
  });

  it('never deals damage below 1 on a hit', () => {
    const rules: GameRules['combat'] = { ...base, armor_cap: 100, max_rounds: 1, kite_factor: 0 };
    const paper: CombatSheet = { pdf: 1, bli: 0, esc: 0, sen: 20, hp: 50, mob: 10 };
    const hard: CombatSheet = { pdf: 0, bli: 0, esc: 0, sen: 1, hp: 50, mob: 1 };
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.5 },
        { fn: 'random', args: [], value: 0.5 },
        { fn: 'randint', args: [1, 20], value: 20 },
        { fn: 'randint', args: [1, 6], value: 1 },
        // B's turn in the same round (kite 0): d20 only, then round ends.
        { fn: 'randint', args: [1, 20], value: 1 },
      ],
      [],
      'min-damage',
    );
    const result = resolveCombat(paper, hard, rules, rng);
    const hit = result.rounds.find((e) => e.hit);
    expect(hit).toBeDefined();
    expect(hit!.damage).toBeGreaterThanOrEqual(1);
    rng.assertDrained();
  });

  it('ends combat at retreat_hp_ratio (round-boundary check; final hit may overshoot)', () => {
    const rules: GameRules['combat'] = { ...base, retreat_hp_ratio: 0.25, max_rounds: 40 };
    const strong: CombatSheet = { pdf: 20, bli: 0, esc: 0, sen: 20, hp: 100, mob: 10 };
    const weak: CombatSheet = { pdf: 0, bli: 0, esc: 0, sen: 1, hp: 40, mob: 1 };
    const result = resolveCombat(strong, weak, rules, createRng(99));
    const minB = 40 * 0.25;
    expect(result.outcome).toBe('A');
    // Retreat condition triggered (B at/below threshold when the loop stopped).
    expect(result.final.hpB).toBeLessThanOrEqual(minB);
    expect(result.final.hpA).toBeGreaterThan(100 * 0.25);
    // Rounds stop once the threshold is crossed at a round boundary — no runaway.
    expect(result.rounds.length).toBeLessThan(40);
    const lastRound = result.rounds.at(-1)?.round ?? 0;
    expect(lastRound).toBeLessThanOrEqual(40);
  });

  it('known defect: pierce_ratio 0 vs 0.35 yields identical outcomes (fura cancels)', () => {
    const rulesNoPierce: GameRules['combat'] = { ...base, pierce_ratio: 0 };
    const rulesPierce: GameRules['combat'] = { ...base, pierce_ratio: 0.35 };
    const gunship: CombatSheet = { pdf: 10, bli: 3, esc: 0, sen: 5, hp: 80, mob: 4 };
    const brick: CombatSheet = { pdf: 2, bli: 7, esc: 8, sen: 2, hp: 100, mob: 3 };
    const outcomes = new Set<string>();
    for (let seed = 0; seed < 25; seed += 1) {
      const a = resolveCombat(gunship, brick, rulesNoPierce, createRng(seed));
      const b = resolveCombat(gunship, brick, rulesPierce, createRng(seed));
      outcomes.add(`${a.outcome}|${b.outcome}`);
      expect(b.outcome).toBe(a.outcome);
      expect(b.final).toEqual(a.final);
    }
    expect(outcomes.size).toBeGreaterThanOrEqual(1);
  });

  it('uses half-to-even rounding for odd-MOB DCs (3 × 1.5 = 4.5 → 4, not 5)', () => {
    const rules: GameRules['combat'] = { ...base, max_rounds: 1, kite_factor: 0 };
    // Defender MOB 3, dodge 1.5 → 4.5 → dc = 10+4 = 14 (half-up would be 15).
    const attacker: CombatSheet = { pdf: 0, bli: 0, esc: 0, sen: 20, hp: 100, mob: 1 };
    const defender: CombatSheet = { pdf: 0, bli: 0, esc: 0, sen: 1, hp: 100, mob: 3 };
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.5 },
        { fn: 'random', args: [], value: 0.5 },
        { fn: 'randint', args: [1, 20], value: 14 },
        { fn: 'randint', args: [1, 6], value: 2 },
        // Defender's turn in the same round (kite 0): d20 miss (low roll vs A's DC).
        { fn: 'randint', args: [1, 20], value: 1 },
      ],
      [],
      'odd-mob-dc',
    );
    const result = resolveCombat(attacker, defender, rules, rng);
    expect(result.rounds[0]?.dc).toBe(14);
    expect(result.rounds[0]?.hit).toBe(true);
    rng.assertDrained();
  });

  it('does not consume first-strike on kite skips (bonus lands on the first real roll)', () => {
    const rules: GameRules['combat'] = {
      ...base,
      first_strike_bonus: 5,
      max_rounds: 1,
      kite_factor: 1,
    };
    // SEN: B first, but B is kited by faster A → only A rolls, with the full bonus.
    const fastA: CombatSheet = { pdf: 0, bli: 0, esc: 0, sen: 0, hp: 100, mob: 20 };
    const slowB: CombatSheet = { pdf: 0, bli: 0, esc: 0, sen: 20, hp: 100, mob: 1 };
    // A vs B: dc = 12. Roll 7 + 0 + 5 = 12 → hit (bonus required; without it 7 < 12).
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.01 },
        { fn: 'random', args: [], value: 0.01 },
        { fn: 'randint', args: [1, 20], value: 7 },
        { fn: 'randint', args: [1, 6], value: 2 },
      ],
      [],
      'skip-consumes-nothing',
    );
    const result = resolveCombat(fastA, slowB, rules, rng);
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0]?.attacker).toBe('A');
    expect(result.rounds[0]?.hit).toBe(true);
    rng.assertDrained();
  });

  it('firstStrikeSide keeps the bonus on that side even when the other side attacks first', () => {
    const rules: GameRules['combat'] = {
      ...base,
      first_strike_bonus: 2,
      kite_factor: 0,
      max_rounds: 1,
    };
    // B has SEN 10 → attacks first. With firstStrikeSide 'A', B never consumes the
    // pending bonus, so A still gets it on A's first real roll (D16b / encounter slot A).
    const a: CombatSheet = { pdf: 0, bli: 0, esc: 0, sen: 0, hp: 100, mob: 4 };
    const b: CombatSheet = { pdf: 10, bli: 0, esc: 0, sen: 10, hp: 100, mob: 3 };
    // B vs A: dc = 10 + roundHalfEven(4 × 1.5) = 16. Roll 5 + 10 = 15 → miss
    // (with the bonus it would be 17 ≥ 16 — proving B did not take it).
    // A vs B: dc = 10 + roundHalfEven(3 × 1.5) = 14. Roll 12 + 0 + 2 = 14 → hit
    // (without the bonus 12 < 14 — proving A did take it).
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.5 },
        { fn: 'random', args: [], value: 0.5 },
        { fn: 'randint', args: [1, 20], value: 5 },
        { fn: 'randint', args: [1, 20], value: 12 },
        { fn: 'randint', args: [1, 6], value: 1 },
      ],
      [],
      'first-strike-side-a',
    );
    const result = resolveCombat(a, b, rules, rng, { firstStrikeSide: 'A' });
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0]?.attacker).toBe('B');
    expect(result.rounds[0]?.dc).toBe(16);
    expect(result.rounds[0]?.hit).toBe(false);
    expect(result.rounds[1]?.attacker).toBe('A');
    expect(result.rounds[1]?.dc).toBe(14);
    expect(result.rounds[1]?.hit).toBe(true);
    rng.assertDrained();
  });
});
