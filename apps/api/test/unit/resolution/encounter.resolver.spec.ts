import { describe, expect, it } from '@jest/globals';
import { ScriptedRng } from '../../../src/common/rng/scripted.rng.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import type { CombatSheet } from '../../../src/resolution/combat/combat.types.js';
import {
  ENCOUNTER_PIPELINE,
  resolveEncounter,
  type EncounterInput,
} from '../../../src/resolution/encounter/encounter.resolver.js';

/** One-round combat keeps ScriptedRng tapes short; everything else is factory defaults. */
const rules: GameRules = {
  ...GAME_CONFIG_DEFAULTS,
  combat: { ...GAME_CONFIG_DEFAULTS.combat, max_rounds: 1 },
};

function sheet(patch: Partial<CombatSheet> = {}): CombatSheet {
  return { pdf: 0, bli: 0, esc: 0, sen: 5, hp: 100, mob: 4, ...patch };
}

function input(patch: Partial<EncounterInput> = {}): EncounterInput {
  return {
    zone: 2,
    danger: 4,
    escortLeg: false,
    isPvp: false,
    player: { sheet: sheet(), preset: 'CRUISE', sensorAlive: true },
    enemy: { sheet: sheet() },
    relation: 'NEUTRAL',
    mission: null,
    missionForcesFlee: false,
    huntTargetMatch: false,
    stance: null,
    enemyDecision: 'IGNORE',
    missionOwner: null,
    ...patch,
  };
}

/** Both kite floats then one d20 per side (equal SEN → A first), all misses. */
const COMBAT_MISS_TAPES = [
  { fn: 'random', args: [], value: 0.5 },
  { fn: 'random', args: [], value: 0.5 },
  { fn: 'randint', args: [1, 20], value: 1 },
  { fn: 'randint', args: [1, 20], value: 1 },
] as const;

describe('resolveEncounter — fixed pipeline (S5.4)', () => {
  it('records only the stages it ran, always in ENCOUNTER_PIPELINE order', () => {
    const rng = new ScriptedRng([{ fn: 'random', args: [], value: 0.5 }], [], 'no-encounter');
    const outcome = resolveEncounter(input({ danger: 4 }), rules, rng);
    expect(outcome.stages).toEqual(['encounter_roll']);
    expect(outcome.encountered).toBe(false);
    expect(outcome.decision).toBeNull();
    expect(outcome.combat).toBeNull();
    expect(outcome.stages.every((stage, i) => stage === ENCOUNTER_PIPELINE[i])).toBe(true);
    rng.assertDrained();
  });

  it('zone gate blocks PvP after detection, before the policy tree', () => {
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.1 },
        { fn: 'random', args: [], value: 0.5 },
      ],
      [],
      'zone-gate',
    );
    const outcome = resolveEncounter(
      input({ zone: 0, isPvp: true, relation: 'HOSTILE', stance: 'AGGRESSIVE' }),
      rules,
      rng,
    );
    expect(outcome.stages).toEqual(['encounter_roll', 'detection']);
    expect(outcome.encountered).toBe(true);
    expect(outcome.pvpBlocked).toBe(true);
    expect(outcome.ambushed).toBe(false);
    expect(outcome.decision).toBeNull();
    expect(outcome.combat).toBeNull();
    rng.assertDrained();
  });

  it('zone gate does not apply to non-PvP contacts in zones 0–1', () => {
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.1 },
        { fn: 'random', args: [], value: 0.5 },
      ],
      [],
      'npc-zone0',
    );
    const outcome = resolveEncounter(
      input({ zone: 0, isPvp: false, relation: 'ALLY' }),
      rules,
      rng,
    );
    expect(outcome.stages).toEqual(['encounter_roll', 'detection', 'policy']);
    expect(outcome.pvpBlocked).toBe(false);
    expect(outcome.decision).toBe('IGNORE');
    rng.assertDrained();
  });

  it('escort legs raise the per-leg chance (danger 4 × 1.5 = 0.3)', () => {
    const hit = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.25 },
        { fn: 'random', args: [], value: 0.5 },
      ],
      [],
      'escort-hit',
    );
    expect(resolveEncounter(input({ escortLeg: true, danger: 4 }), rules, hit).encountered).toBe(
      true,
    );
    hit.assertDrained();

    const miss = new ScriptedRng([{ fn: 'random', args: [], value: 0.35 }], [], 'escort-miss');
    expect(resolveEncounter(input({ escortLeg: true, danger: 4 }), rules, miss).encountered).toBe(
      false,
    );
    miss.assertDrained();
  });

  it('IGNORE stops after the policy stage — no escape, no combat, even when ambushed', () => {
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.1 },
        { fn: 'random', args: [], value: 0.5 },
      ],
      [],
      'ignore-ambushed',
    );
    const outcome = resolveEncounter(
      input({ relation: 'ALLY', player: { sheet: sheet(), preset: 'CRUISE', sensorAlive: false } }),
      rules,
      rng,
    );
    expect(outcome.stages).toEqual(['encounter_roll', 'detection', 'policy']);
    expect(outcome.ambushed).toBe(true);
    expect(outcome.decision).toBe('IGNORE');
    expect(outcome.escape).toBeNull();
    expect(outcome.combat).toBeNull();
    rng.assertDrained();
  });

  it('dead sensor ambushes a fleeing ship, skips escape, and hands the enemy slot A', () => {
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.1 },
        { fn: 'random', args: [], value: 0.5 },
        ...COMBAT_MISS_TAPES,
      ],
      [],
      'dead-sensor-ambush',
    );
    const outcome = resolveEncounter(
      input({
        mission: 'DELIVERY',
        missionForcesFlee: true,
        player: { sheet: sheet({ sen: 5, mob: 4 }), preset: 'CRUISE', sensorAlive: false },
        enemy: { sheet: sheet({ sen: 5, mob: 4 }) },
      }),
      rules,
      rng,
    );
    expect(outcome.stages).toEqual(['encounter_roll', 'detection', 'policy', 'combat']);
    expect(outcome.ambushed).toBe(true);
    expect(outcome.decision).toBe('FLEE');
    expect(outcome.escape).toBeNull();
    expect(outcome.escaped).toBe(false);
    expect(outcome.slotA).toBe('enemy');
    expect(outcome.slotARule).toBe('ambushed');
    expect(outcome.combat?.playerIsA).toBe(false);
    rng.assertDrained();
  });

  it('successful flee stops after the escape stage — no combat', () => {
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.1 },
        { fn: 'random', args: [], value: 0.5 },
        { fn: 'randint', args: [1, 20], value: 20 },
        { fn: 'randint', args: [8, 15], value: 12 },
      ],
      [],
      'flee-success',
    );
    const outcome = resolveEncounter(
      input({
        mission: 'TRANSPORT',
        missionForcesFlee: true,
        player: { sheet: sheet({ sen: 5, mob: 4 }), preset: 'CRUISE', sensorAlive: true },
        enemy: { sheet: sheet({ sen: 5, mob: 4 }) },
      }),
      rules,
      rng,
    );
    expect(outcome.stages).toEqual(['encounter_roll', 'detection', 'policy', 'escape']);
    expect(outcome.ambushed).toBe(false);
    expect(outcome.decision).toBe('FLEE');
    expect(outcome.escaped).toBe(true);
    expect(outcome.escape?.success).toBe(true);
    expect(outcome.escape?.motorOverloadPercent).toBe(12);
    expect(outcome.slotA).toBeNull();
    expect(outcome.combat).toBeNull();
    rng.assertDrained();
  });

  it('flee-fail runs the full pipeline: escape then combat with enemy slot A', () => {
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.1 },
        { fn: 'random', args: [], value: 0.5 },
        { fn: 'randint', args: [1, 20], value: 20 },
        { fn: 'randint', args: [8, 15], value: 12 },
        { fn: 'random', args: [], value: 0.5 },
        { fn: 'random', args: [], value: 0.5 },
        { fn: 'randint', args: [1, 20], value: 1 },
      ],
      [],
      'flee-fail-full',
    );
    const outcome = resolveEncounter(
      input({
        mission: 'DELIVERY',
        missionForcesFlee: true,
        player: { sheet: sheet({ sen: 5, mob: 4 }), preset: 'CRUISE', sensorAlive: true },
        enemy: { sheet: sheet({ sen: 5, mob: 10 }) },
      }),
      rules,
      rng,
    );
    expect(outcome.stages).toEqual(ENCOUNTER_PIPELINE);
    expect(outcome.ambushed).toBe(false);
    expect(outcome.decision).toBe('FLEE');
    expect(outcome.escape?.success).toBe(false);
    expect(outcome.escaped).toBe(false);
    expect(outcome.slotA).toBe('enemy');
    expect(outcome.slotARule).toBe('failed_escape');
    expect(outcome.combat?.playerIsA).toBe(false);
    expect(outcome.combat?.result.rounds).toHaveLength(1);
    expect(outcome.combat?.result.rounds[0]?.attacker).toBe('A');
    expect(outcome.combat?.result.rounds[0]?.hit).toBe(false);
    rng.assertDrained();
  });

  it('unique aggressor takes slot A on an attack encounter', () => {
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.1 },
        { fn: 'random', args: [], value: 0.5 },
        ...COMBAT_MISS_TAPES,
      ],
      [],
      'aggressor-attack',
    );
    const outcome = resolveEncounter(
      input({
        isPvp: true,
        relation: 'HOSTILE',
        stance: 'AGGRESSIVE',
        enemyDecision: 'IGNORE',
      }),
      rules,
      rng,
    );
    expect(outcome.stages).toEqual(['encounter_roll', 'detection', 'policy', 'combat']);
    expect(outcome.decision).toBe('ATTACK');
    expect(outcome.slotA).toBe('player');
    expect(outcome.slotARule).toBe('aggressor');
    expect(outcome.combat?.playerIsA).toBe(true);
    expect(outcome.combat?.winner).toBe('draw');
    rng.assertDrained();
  });

  it('mutual attack with equal SEN is broken by the seeded coin flip', () => {
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.1 },
        { fn: 'random', args: [], value: 0.5 },
        { fn: 'randint', args: [0, 1], value: 0 },
        ...COMBAT_MISS_TAPES,
      ],
      [],
      'coin-flip-pipeline',
    );
    const outcome = resolveEncounter(
      input({
        isPvp: true,
        relation: 'HOSTILE',
        stance: 'AGGRESSIVE',
        enemyDecision: 'ATTACK',
        missionOwner: null,
      }),
      rules,
      rng,
    );
    expect(outcome.decision).toBe('ATTACK');
    expect(outcome.slotA).toBe('player');
    expect(outcome.slotARule).toBe('equal_sen_coin_flip');
    expect(outcome.combat?.playerIsA).toBe(true);
    rng.assertDrained();
  });
});
