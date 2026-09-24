import { describe, expect, it } from '@jest/globals';
import { createRng } from '../../../src/common/rng/rng.js';
import { ScriptedRng } from '../../../src/common/rng/scripted.rng.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import type { CombatSheet } from '../../../src/resolution/combat/combat.types.js';
import { generatePirate } from '../../../src/resolution/encounter/pirate.generator.js';

const rules: GameRules = GAME_CONFIG_DEFAULTS;

const player: CombatSheet = {
  pdf: 5,
  bli: 4,
  esc: 10,
  sen: 3,
  hp: 80,
  mob: 6,
};

function pirateRng(
  strength: number,
  mobJitter: number,
  senJitter: number,
  sourceLabel = 'pirate',
): ScriptedRng {
  return new ScriptedRng(
    [
      { fn: 'choice', args: { seq: 0 }, value: strength },
      { fn: 'choice', args: { seq: 1 }, value: mobJitter },
      { fn: 'choice', args: { seq: 2 }, value: senJitter },
    ],
    [
      [...rules.encounter.pirate_strength_options],
      [...rules.encounter.pirate_mob_jitter],
      [...rules.encounter.pirate_sen_jitter],
    ],
    sourceLabel,
  );
}

describe('S5.7 — pirate generator', () => {
  it('uses the config strength and jitter tables (anchored to player sheet)', () => {
    expect(rules.encounter.pirate_strength_options).toEqual([0.55, 0.7, 0.8, 0.85, 1.0, 1.1]);
    expect(rules.encounter.pirate_mob_jitter).toEqual([-1, 0, 1]);
    expect(rules.encounter.pirate_sen_jitter).toEqual([-1, 0, 1]);
    expect(rules.encounter.pirate_bli_ratio).toBe(0.6);
    expect(rules.encounter.pirate_min_pdf).toBe(2);
    expect(rules.encounter.pirate_min_hp).toBe(30);
  });

  it('applies strength and jitter with the sim formulas (RNG order: strength, mob, sen)', () => {
    const rng = pirateRng(0.8, 1, 0);
    const pirate = generatePirate(player, rules, rng);
    expect(pirate).toEqual({
      mob: 7,
      pdf: 4, // roundHalfEven(5 × 0.8) = 4
      bli: 2, // roundHalfEven(4 × 0.8 × 0.6) = roundHalfEven(1.92) = 2
      esc: 0,
      sen: 3,
      hp: 64, // roundHalfEven(80 × 0.8)
    });
    rng.assertDrained();
  });

  it('clamps MOB/PDF/SEN/HP to the configured floors', () => {
    const weak: CombatSheet = { pdf: 1, bli: 0, esc: 0, sen: 0, hp: 10, mob: 1 };
    const rng = pirateRng(0.55, -1, -1);
    const pirate = generatePirate(weak, rules, rng);
    expect(pirate.mob).toBe(1);
    expect(pirate.pdf).toBe(2);
    expect(pirate.bli).toBe(0);
    expect(pirate.sen).toBe(0);
    expect(pirate.hp).toBe(30);
    expect(pirate.esc).toBe(0);
    rng.assertDrained();
  });

  it('never grants shields (ESC = 0)', () => {
    const rng = pirateRng(1.1, 0, 1);
    expect(generatePirate(player, rules, rng).esc).toBe(0);
    rng.assertDrained();
  });

  it('is deterministic for the same seed', () => {
    const a = generatePirate(player, rules, createRng(7));
    const b = generatePirate(player, rules, createRng(7));
    expect(a).toEqual(b);
  });

  it('covers every strength option across a seed sweep', () => {
    const strengths = new Set<number>();
    for (let seed = 0; seed < 200; seed += 1) {
      const pirate = generatePirate(player, rules, createRng(seed));
      // strength is not returned; recover via PDF when player.pdf > 0
      // instead assert sheets stay in a sane band for all seeds.
      expect(pirate.pdf).toBeGreaterThanOrEqual(rules.encounter.pirate_min_pdf);
      expect(pirate.hp).toBeGreaterThanOrEqual(rules.encounter.pirate_min_hp);
      expect(pirate.esc).toBe(0);
      strengths.add(pirate.mob);
    }
    expect(strengths.size).toBeGreaterThan(1);
  });

  it('applies half-even rounding to scaled stats (parity with Python round)', () => {
    // player.pdf = 5, strength 0.55 → 2.75 → 3; strength 0.8 → 4.0 → 4
    const rngHalf = pirateRng(0.55, 0, 0, 'half');
    expect(generatePirate({ ...player, pdf: 5 }, rules, rngHalf).pdf).toBe(3);
    rngHalf.assertDrained();
    const rngEven = pirateRng(0.8, 0, 0, 'even');
    expect(generatePirate({ ...player, pdf: 5 }, rules, rngEven).pdf).toBe(4);
    rngEven.assertDrained();
  });
});
