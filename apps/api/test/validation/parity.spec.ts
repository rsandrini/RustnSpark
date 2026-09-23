/**
 * Layers 1–2 exact parity (plan S5.10).
 *
 * Layer 1: every combat tape — outcome, final HP/shield, drained RNG.
 * Layer 2: every life tape — final credits/tier/condition, mission/choke counts.
 */
import { describe, expect, it } from '@jest/globals';
import {
  buildSheetsFromTapes,
  loadCombatTapes,
  mapOutcome,
  replayTape,
  toSheet,
  torneioRules,
} from './tournament.js';
import { resolveCombat } from '../../src/resolution/combat/combat.resolver.js';
import { ScriptedRng } from '../../src/common/rng/scripted.rng.js';
import { loadLifeTapes, replayLife, umaVida } from './life-sim.js';

const combatFixture = loadCombatTapes();
const lifeFixture = loadLifeTapes();

describe('S5.10 Layer 1 — combat tape parity', () => {
  it('replays all 600 tapes: outcome, final HP/shield, drained RNG', () => {
    expect(combatFixture.tapes).toHaveLength(600);
    const rules = torneioRules(combatFixture);
    for (const tape of combatFixture.tapes) {
      expect(() => replayTape(tape, combatFixture, rules)).not.toThrow();
    }
  });

  it('covers all 10 build pairs in both slot orders', () => {
    const directed = new Set(combatFixture.tapes.map((t) => `${t.slot_a}|${t.slot_b}`));
    const unordered = new Set(
      combatFixture.tapes.map((t) => [t.slot_a, t.slot_b].sort().join('|')),
    );
    expect(unordered.size).toBe(10);
    expect(directed.size).toBe(20);
  });

  it('exposes the five torneio builds with sheets for Layer 3', () => {
    const sheets = buildSheetsFromTapes(combatFixture);
    expect(Object.keys(sheets).sort()).toEqual(
      ['Blindado', 'DanoAlto', 'Equilib', 'Escudo', 'Rapido'].sort(),
    );
    expect(sheets['Rapido']?.mob).toBeGreaterThan(0);
  });

  it('maps draw outcome e → draw', () => {
    expect(mapOutcome('e')).toBe('draw');
    expect(mapOutcome('A')).toBe('A');
  });

  it('single-tape reference replay matches resolveCombat directly', () => {
    const tape = combatFixture.tapes[0]!;
    const rules = torneioRules(combatFixture);
    const rng = new ScriptedRng(tape.entries, combatFixture.seqs, 'ref');
    const result = resolveCombat(toSheet(tape.fichas.A), toSheet(tape.fichas.B), rules, rng);
    expect(result.outcome).toBe(mapOutcome(tape.outcome));
    expect(result.final).toEqual(tape.final);
    expect(() => rng.assertDrained()).not.toThrow();
  });
});

describe('S5.10 Layer 2 — whole-life tape parity', () => {
  it('has ≥20 lives across the 3 GDD configs', () => {
    expect(lifeFixture.lives.length).toBeGreaterThanOrEqual(20);
    expect(lifeFixture.configs).toEqual(['manutencao_100', 'manutencao_200', 'manutencao_350']);
  });

  it('replays every life: credits, tier, missions, chokes, combats, drained RNG', () => {
    for (const life of lifeFixture.lives) {
      expect(() => replayLife(life, lifeFixture)).not.toThrow();
    }
  });

  it('life 0 matches the recorded final snapshot exactly', () => {
    const life = lifeFixture.lives[0]!;
    const rng = new ScriptedRng(life.entries, lifeFixture.seqs, 'life0');
    const result = umaVida(life.config_values, rng);
    expect(result.final).toEqual(life.final);
    expect(result.metrics.missoes).toBe(life.metrics.missoes);
    expect(result.metrics.engasgos).toBe(life.metrics.engasgos);
    expect(result.metrics.falencia).toBe(life.metrics.falencia);
    expect(() => rng.assertDrained()).not.toThrow();
  });
});
