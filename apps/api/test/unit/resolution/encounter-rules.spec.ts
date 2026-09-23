import { describe, expect, it } from '@jest/globals';
import { createRng } from '../../../src/common/rng/rng.js';
import { ScriptedRng } from '../../../src/common/rng/scripted.rng.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import { ambushChance } from '../../../src/resolution/encounter/detection.js';
import { encounterChance, pvpAllowed } from '../../../src/resolution/encounter/encounter-chance.js';
import {
  POLICY_TREE_ORDER,
  SLOT_A_PRECEDENCE,
  decidePolicy,
  resolveSlotA,
  type PolicyContext,
} from '../../../src/resolution/encounter/encounter-policy.js';
import {
  attemptEscape,
  evaluateEscape,
  type EscapePreset,
} from '../../../src/resolution/encounter/escape.resolver.js';
import { ENCOUNTER_PIPELINE } from '../../../src/resolution/encounter/encounter.resolver.js';
import { rating, shouldAttackNeutral } from '../../../src/resolution/encounter/stance.js';
import {
  AMBUSH_CONSEQUENCES,
  DETECTION_CASES,
  ENCOUNTER_CHANCE_CASES,
  ENCOUNTER_PIPELINE as FIXTURE_PIPELINE,
  ESCAPE_ATTEMPT_WEAR,
  ESCAPE_CASES,
  ESCAPE_FAILURE_CONSEQUENCE,
  PVP_ZONE_CASES,
  POLICY_CASES,
  POLICY_TREE_ORDER as FIXTURE_POLICY_ORDER,
  PRESET_CASES,
  SLOT_A_PRECEDENCE as FIXTURE_SLOT_A,
  STANCE_CASES,
  type PolicyCase,
} from '../../fixtures/appendix-e.js';

const rules: GameRules = GAME_CONFIG_DEFAULTS;

function policyContext(c: PolicyCase): PolicyContext {
  return {
    relation: c.relation,
    mission: c.mission,
    missionForcesFlee: c.missionForcesFlee,
    huntTargetMatch: c.huntTargetMatch,
    stance: c.stance,
    selfRating: c.selfRating ?? 0,
    enemyRating: c.enemyRating ?? 0,
  };
}

describe('S5.4 — encounter rules (Appendix E table-driven)', () => {
  describe('structural orderings', () => {
    it('pipeline order matches Appendix E exactly', () => {
      expect(ENCOUNTER_PIPELINE).toEqual(FIXTURE_PIPELINE);
      expect(ENCOUNTER_PIPELINE).toEqual([
        'encounter_roll',
        'detection',
        'policy',
        'escape',
        'combat',
      ]);
    });

    it('policy-tree order matches Appendix E exactly', () => {
      expect(POLICY_TREE_ORDER).toEqual(FIXTURE_POLICY_ORDER);
      expect(POLICY_TREE_ORDER).toEqual([
        'ally_ignore',
        'mission_forces_flee',
        'hunt_target_attack',
        'faction_stance',
        'default_ignore',
      ]);
    });

    it('slot-A precedence matches Appendix E exactly', () => {
      expect(SLOT_A_PRECEDENCE).toEqual(FIXTURE_SLOT_A);
      expect(SLOT_A_PRECEDENCE).toEqual([
        'ambushed',
        'failed_escape',
        'aggressor',
        'mission_owner',
        'equal_sen_coin_flip',
      ]);
    });
  });

  describe('encounter chance [D17]', () => {
    it('every ENCOUNTER_CHANCE_CASES row matches danger / chance_divisor (× escort)', () => {
      for (const c of ENCOUNTER_CHANCE_CASES) {
        const chance = encounterChance(c.danger, rules, c.escortLeg);
        expect({ name: c.name, chance }).toEqual({
          name: c.name,
          chance: expect.closeTo(c.chance, 12),
        });
      }
    });
  });

  describe('PvP zone gate', () => {
    it('every PVP_ZONE_CASES row matches pvpAllowed(zone)', () => {
      for (const c of PVP_ZONE_CASES) {
        expect({ zone: c.zone, pvpAllowed: pvpAllowed(c.zone) }).toEqual(c);
      }
    });
  });

  describe('detection / ambush', () => {
    it('every DETECTION_CASES row matches the approved ambush formula', () => {
      for (const c of DETECTION_CASES) {
        const chance = ambushChance(c.playerSen, c.enemySen, c.sensorAlive, rules.detection);
        expect({ name: c.name, chance }).toEqual({
          name: c.name,
          chance: expect.closeTo(c.ambushChance, 12),
        });
      }
    });

    it('pins the structural ambush consequences', () => {
      expect(AMBUSH_CONSEQUENCES).toEqual({
        enemyTakesSlotA: true,
        playerLosesFirstStrike: true,
        escapeAllowed: false,
      });
    });
  });

  describe('neutral stance rating', () => {
    it('every STANCE_CASES row follows the approved rating formula and boundary', () => {
      for (const c of STANCE_CASES) {
        const attack = shouldAttackNeutral(c.self, c.enemy, rules.stance);
        expect({ name: c.name, attack }).toEqual({ name: c.name, attack: c.attack });
      }
    });

    it('rating is PDF × (HP + ESC + rating_armor_weight × BLI)', () => {
      const ship = { pdf: 10, hp: 50, esc: 14, bli: 3 };
      expect(rating(ship, rules.stance)).toBe(10 * (50 + 14 + 5 * 3));
    });
  });

  describe('policy tree', () => {
    it('every POLICY_CASES row is decided top-down by decidePolicy', () => {
      for (const c of POLICY_CASES) {
        const decision = decidePolicy(policyContext(c), rules.stance);
        expect({ name: c.name, decision }).toEqual({ name: c.name, decision: c.expected });
      }
    });
  });

  describe('escape evaluation', () => {
    it('every ESCAPE_CASES row matches evaluateEscape', () => {
      for (const c of ESCAPE_CASES) {
        const result = evaluateEscape(
          {
            playerMob: c.mob,
            enemyMob: c.enemyMob,
            enemySen: c.enemySen,
            preset: c.preset,
            d20: c.d20,
          },
          rules,
        );
        expect({ name: c.name, success: result.success }).toEqual({
          name: c.name,
          success: c.success,
        });
      }
    });

    it('only the ESCAPE preset carries the +2 bonus (PRESET_CASES)', () => {
      for (const p of PRESET_CASES) {
        const result = evaluateEscape(
          {
            playerMob: 3,
            enemyMob: 3,
            enemySen: 0,
            preset: p.preset,
            d20: 8,
          },
          rules,
        );
        expect({ preset: p.preset, bonus: result.bonus }).toEqual({
          preset: p.preset,
          bonus: p.escapeRollBonus,
        });
        expect(p.combatNumericEffect).toBeNull();
      }
    });

    it('pins the overload wear bounds applied to every escape attempt', () => {
      expect(ESCAPE_ATTEMPT_WEAR.minPercent).toBe(rules.wear.overload_min);
      expect(ESCAPE_ATTEMPT_WEAR.maxPercent).toBe(rules.wear.overload_max);
      expect(ESCAPE_ATTEMPT_WEAR.appliesToPartClass).toBe('ENGINE');
      expect(rules.wear.overload_min).toBe(8);
      expect(rules.wear.overload_max).toBe(15);
    });

    it('pins the escape-failure consequence: enemy takes slot A and the first strike', () => {
      expect(ESCAPE_FAILURE_CONSEQUENCE).toEqual({
        enemyTakesSlotA: true,
        enemyGetsFirstStrikeBonus: true,
      });
      expect(rules.combat.first_strike_bonus).toBe(2);
    });

    it('attemptEscape draws d20 then overload and reports both (success still wears)', () => {
      const rng = new ScriptedRng(
        [
          { fn: 'randint', args: [1, 20], value: 20 },
          { fn: 'randint', args: [8, 15], value: 12 },
        ],
        [],
        'escape-attempt-success',
      );
      const attempt = attemptEscape({ mob: 4 }, { mob: 4, sen: 5 }, 'CRUISE', rules, rng);
      expect(attempt.success).toBe(true);
      expect(attempt.motorOverloadPercent).toBe(12);
      expect(attempt.motorOverloadPercent).toBeGreaterThanOrEqual(ESCAPE_ATTEMPT_WEAR.minPercent);
      expect(attempt.motorOverloadPercent).toBeLessThanOrEqual(ESCAPE_ATTEMPT_WEAR.maxPercent);
      rng.assertDrained();
    });

    it('attemptEscape wears the motors even when the escape fails', () => {
      const rng = new ScriptedRng(
        [
          { fn: 'randint', args: [1, 20], value: 1 },
          { fn: 'randint', args: [8, 15], value: 8 },
        ],
        [],
        'escape-attempt-fail',
      );
      const attempt = attemptEscape({ mob: 1 }, { mob: 12, sen: 10 }, 'CRUISE', rules, rng);
      expect(attempt.success).toBe(false);
      expect(attempt.motorOverloadPercent).toBe(8);
      rng.assertDrained();
    });

    it('success is monotone non-decreasing in player MOB (property)', () => {
      const presets: readonly EscapePreset[] = ['CRUISE', 'COMBAT', 'ESCAPE'];
      for (const preset of presets) {
        for (let mob = 1; mob < 12; mob += 1) {
          for (let d20 = 1; d20 <= 20; d20 += 1) {
            const lower = evaluateEscape(
              { playerMob: mob, enemyMob: 5, enemySen: 3, preset, d20 },
              rules,
            );
            const higher = evaluateEscape(
              { playerMob: mob + 1, enemyMob: 5, enemySen: 3, preset, d20 },
              rules,
            );
            if (lower.success) {
              expect({ preset, mob, d20, success: higher.success }).toEqual({
                preset,
                mob,
                d20,
                success: true,
              });
            }
          }
        }
      }
    });

    it('success is monotone non-increasing in enemy MOB (property)', () => {
      const presets: readonly EscapePreset[] = ['CRUISE', 'COMBAT', 'ESCAPE'];
      for (const preset of presets) {
        for (let enemyMob = 1; enemyMob < 12; enemyMob += 1) {
          for (let d20 = 1; d20 <= 20; d20 += 1) {
            const weaker = evaluateEscape(
              { playerMob: 4, enemyMob, enemySen: 2, preset, d20 },
              rules,
            );
            const stronger = evaluateEscape(
              { playerMob: 4, enemyMob: enemyMob + 1, enemySen: 2, preset, d20 },
              rules,
            );
            if (stronger.success) {
              expect({ preset, enemyMob, d20, success: weaker.success }).toEqual({
                preset,
                enemyMob,
                d20,
                success: true,
              });
            }
          }
        }
      }
    });
  });

  describe('slot-A precedence (D16b)', () => {
    const base = {
      ambushed: false,
      escapeFailed: false,
      playerAggressor: false,
      enemyAggressor: false,
      missionOwner: null,
      playerSen: 5,
      enemySen: 5,
    } as const;

    it('ambushed beats every later rule', () => {
      const resolved = resolveSlotA(
        {
          ...base,
          ambushed: true,
          escapeFailed: true,
          playerAggressor: true,
          enemyAggressor: false,
          missionOwner: 'player',
          playerSen: 20,
          enemySen: 0,
        },
        createRng(1),
      );
      expect(resolved).toEqual({ side: 'enemy', rule: 'ambushed' });
    });

    it('failed escape beats aggressor, mission owner and SEN', () => {
      const resolved = resolveSlotA(
        {
          ...base,
          escapeFailed: true,
          playerAggressor: true,
          missionOwner: 'player',
          playerSen: 20,
          enemySen: 0,
        },
        createRng(1),
      );
      expect(resolved).toEqual({ side: 'enemy', rule: 'failed_escape' });
    });

    it('a unique player aggressor takes slot A', () => {
      const resolved = resolveSlotA(
        { ...base, playerAggressor: true, enemyAggressor: false },
        createRng(1),
      );
      expect(resolved).toEqual({ side: 'player', rule: 'aggressor' });
    });

    it('a unique enemy aggressor takes slot A', () => {
      const resolved = resolveSlotA(
        { ...base, playerAggressor: false, enemyAggressor: true },
        createRng(1),
      );
      expect(resolved).toEqual({ side: 'enemy', rule: 'aggressor' });
    });

    it('mutual attack falls through to the mission owner', () => {
      const resolved = resolveSlotA(
        {
          ...base,
          playerAggressor: true,
          enemyAggressor: true,
          missionOwner: 'player',
        },
        createRng(1),
      );
      expect(resolved).toEqual({ side: 'player', rule: 'mission_owner' });
    });

    it('mutual attack without an owner elects the higher SEN', () => {
      expect(
        resolveSlotA(
          { ...base, playerAggressor: true, enemyAggressor: true, playerSen: 7, enemySen: 3 },
          createRng(1),
        ),
      ).toEqual({ side: 'player', rule: 'aggressor' });
      expect(
        resolveSlotA(
          { ...base, playerAggressor: true, enemyAggressor: true, playerSen: 3, enemySen: 7 },
          createRng(1),
        ),
      ).toEqual({ side: 'enemy', rule: 'aggressor' });
    });

    it('equal SEN with no owner is the D16b seeded coin flip', () => {
      const input = {
        ...base,
        playerAggressor: true,
        enemyAggressor: true,
        playerSen: 5,
        enemySen: 5,
      };
      const heads = new ScriptedRng([{ fn: 'randint', args: [0, 1], value: 0 }], [], 'coin-player');
      expect(resolveSlotA(input, heads)).toEqual({
        side: 'player',
        rule: 'equal_sen_coin_flip',
      });
      heads.assertDrained();

      const tails = new ScriptedRng([{ fn: 'randint', args: [0, 1], value: 1 }], [], 'coin-enemy');
      expect(resolveSlotA(input, tails)).toEqual({
        side: 'enemy',
        rule: 'equal_sen_coin_flip',
      });
      tails.assertDrained();
    });
  });
});
