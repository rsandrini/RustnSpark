import { describe, expect, it } from '@jest/globals';
import { getRegistryEntry } from '../../../src/config/config-registry.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { validateGameRules } from '../../../src/config/game-rules.schema.js';
import {
  AMBUSH_CONSEQUENCES,
  APPENDIX_E_DEFAULTS,
  CHOKE_CASES,
  CHOKE_CONSEQUENCE_CASES,
  DETECTION_CASES,
  ENCOUNTER_CHANCE_CASES,
  ESCAPE_ATTEMPT_WEAR,
  ESCAPE_CASES,
  ESCAPE_FAILURE_CONSEQUENCE,
  ESCORT_SHARE_CASES,
  INTEGRITY_CASES,
  MINING_CASES,
  PAYOUT_CASES,
  POLICY_CASES,
  POLICY_TREE_ORDER,
  PVP_ZONE_CASES,
  PRESET_CASES,
  RESCUE_DEADLINE_CASES,
  SHIP_CLASS_PRECEDENCE,
  SLOT_A_PRECEDENCE,
  STANCE_CASES,
  type PolicyCase,
} from '../../fixtures/appendix-e.js';

// S5.0 sign-off gate: the owner approved Appendix E on 2026-09-21 (D13/D16/D17/D18).
// This suite is the contract those decisions produced — factory defaults must match the
// pinned values, and every table-driven case must follow the approved formulas, so S5.4–S5.6
// can consume the fixture with no numeric oracle of its own.

function valueAt(rules: unknown, dottedKey: string): unknown {
  let cursor: unknown = rules;
  for (const segment of dottedKey.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

// Python round() is half-to-even (D16d): 4.5 → 4, 5.5 → 6, 2.5 → 2. S5.2 will move this
// to src/resolution/numeric/round-half-even.ts; until then the gate carries its own copy so
// a wrong factory default cannot hide behind a wrong helper.
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const ceil = Math.ceil(value);
  const midpoint = floor + 0.5;
  if (value < midpoint) return floor;
  if (value > midpoint) return ceil;
  return floor % 2 === 0 ? floor : ceil;
}

function rating(pdf: number, hp: number, esc: number, bli: number, armorWeight: number): number {
  return pdf * (hp + esc + armorWeight * bli);
}

function decidePolicy(c: PolicyCase, neutralRatio: number): 'IGNORE' | 'FLEE' | 'ATTACK' {
  if (c.relation === 'ALLY') return 'IGNORE';
  if (c.missionForcesFlee) return 'FLEE';
  if (c.mission === 'HUNT' && c.huntTargetMatch) return 'ATTACK';
  if (c.relation === 'HOSTILE') {
    if (c.stance === 'AGGRESSIVE') return 'ATTACK';
    if (c.stance === 'DEFENSIVE') return 'IGNORE';
    if (c.stance === 'NEUTRAL') {
      if (c.selfRating === null || c.enemyRating === null) return 'IGNORE';
      return c.selfRating >= neutralRatio * c.enemyRating ? 'ATTACK' : 'IGNORE';
    }
    return 'IGNORE';
  }
  return 'IGNORE';
}

describe('S5.0 — Appendix E sign-off gate', () => {
  describe('pinned defaults', () => {
    it('every approved key exists in GAME_CONFIG_DEFAULTS with exactly the approved value', () => {
      for (const [key, approved] of Object.entries(APPENDIX_E_DEFAULTS)) {
        expect({ key, value: valueAt(GAME_CONFIG_DEFAULTS, key) }).toEqual({
          key,
          value: approved,
        });
      }
    });

    it('every approved key is registered with bounds containing the approved value', () => {
      for (const [key, approved] of Object.entries(APPENDIX_E_DEFAULTS)) {
        const entry = getRegistryEntry(key);
        if (entry === undefined) {
          throw new Error(`missing registry entry for approved key ${key}`);
        }
        if (typeof approved === 'number' && (entry.type === 'number' || entry.type === 'integer')) {
          expect(approved).toBeGreaterThanOrEqual(entry.min);
          expect(approved).toBeLessThanOrEqual(entry.max);
        }
      }
    });

    it('factory defaults still validate as a whole', () => {
      expect(() => validateGameRules(GAME_CONFIG_DEFAULTS)).not.toThrow();
    });
  });

  describe('Python half-to-even anchor (D16d)', () => {
    it('matches the cases the plan pins', () => {
      expect(roundHalfEven(4.5)).toBe(4);
      expect(roundHalfEven(5.5)).toBe(6);
      expect(roundHalfEven(2.5)).toBe(2);
      expect(roundHalfEven(7.5)).toBe(8);
      expect(roundHalfEven(10.5)).toBe(10);
      expect(roundHalfEven(0.5)).toBe(0);
      expect(roundHalfEven(4.4)).toBe(4);
      expect(roundHalfEven(4.6)).toBe(5);
    });
  });

  describe('escape table [S5.4]', () => {
    const dodge = APPENDIX_E_DEFAULTS['combat.dodge_factor'];
    const dcBase = APPENDIX_E_DEFAULTS['combat.dc_base'];
    const senWeight = APPENDIX_E_DEFAULTS['escape.enemy_sen_weight'];
    const presetBonus = APPENDIX_E_DEFAULTS['escape.preset_bonus'];

    it('every case matches the approved escape formula', () => {
      for (const c of ESCAPE_CASES) {
        const bonus = c.preset === 'ESCAPE' ? presetBonus : 0;
        const roll = c.d20 + bonus + roundHalfEven(c.mob * dodge);
        const dc = dcBase + roundHalfEven(c.enemyMob * dodge) + c.enemySen * senWeight;
        expect({ name: c.name, success: roll >= dc }).toEqual({
          name: c.name,
          success: c.success,
        });
      }
    });

    it('only the ESCAPE preset carries the approved +2 bonus', () => {
      for (const p of PRESET_CASES) {
        expect(p.escapeRollBonus).toBe(p.preset === 'ESCAPE' ? presetBonus : 0);
        expect(p.combatNumericEffect).toBeNull();
      }
    });

    it('pins the overload wear applied to every escape attempt', () => {
      expect(ESCAPE_ATTEMPT_WEAR.minPercent).toBe(APPENDIX_E_DEFAULTS['wear.overload_min']);
      expect(ESCAPE_ATTEMPT_WEAR.maxPercent).toBe(APPENDIX_E_DEFAULTS['wear.overload_max']);
      expect(ESCAPE_ATTEMPT_WEAR.appliesToPartClass).toBe('ENGINE');
    });

    it('pins the failure consequence: enemy takes slot A and the first strike', () => {
      expect(ESCAPE_FAILURE_CONSEQUENCE).toEqual({
        enemyTakesSlotA: true,
        enemyGetsFirstStrikeBonus: true,
      });
      expect(APPENDIX_E_DEFAULTS['combat.first_strike_bonus']).toBe(2);
    });
  });

  describe('detection table [S5.4]', () => {
    const perSen = APPENDIX_E_DEFAULTS['detection.ambush_per_sen_point'];
    const cap = APPENDIX_E_DEFAULTS['detection.ambush_cap'];

    it('every case matches the approved ambush formula', () => {
      for (const c of DETECTION_CASES) {
        let chance: number;
        if (!c.sensorAlive) {
          chance = 1;
        } else if (c.enemySen > c.playerSen) {
          chance = Math.min((c.enemySen - c.playerSen) * perSen, cap);
        } else {
          chance = 0;
        }
        expect({ name: c.name, chance }).toEqual({
          name: c.name,
          chance: expect.closeTo(c.ambushChance, 12),
        });
      }
    });

    it('an ambushed ship loses slot A and the first strike, and may not escape', () => {
      expect(AMBUSH_CONSEQUENCES).toEqual({
        enemyTakesSlotA: true,
        playerLosesFirstStrike: true,
        escapeAllowed: false,
      });
    });
  });

  describe('stance table [S5.4]', () => {
    const ratio = APPENDIX_E_DEFAULTS['stance.neutral_attack_ratio'];
    const armorWeight = APPENDIX_E_DEFAULTS['stance.rating_armor_weight'];

    it('every case matches the approved rating formula', () => {
      for (const c of STANCE_CASES) {
        const self = rating(c.self.pdf, c.self.hp, c.self.esc, c.self.bli, armorWeight);
        const enemy = rating(c.enemy.pdf, c.enemy.hp, c.enemy.esc, c.enemy.bli, armorWeight);
        expect({ name: c.name, attack: self >= ratio * enemy }).toEqual({
          name: c.name,
          attack: c.attack,
        });
      }
    });
  });

  describe('encounter chance table [S5.4, D17]', () => {
    const divisor = APPENDIX_E_DEFAULTS['encounter.chance_divisor'];
    const escortMult = APPENDIX_E_DEFAULTS['escort.encounter_multiplier'];

    it('every case matches danger / chance_divisor, with the escort multiplier on escort legs', () => {
      for (const c of ENCOUNTER_CHANCE_CASES) {
        const chance = (c.danger / divisor) * (c.escortLeg ? escortMult : 1);
        expect({ name: c.name, chance }).toEqual({
          name: c.name,
          chance: expect.closeTo(c.chance, 12),
        });
      }
    });

    it('zones 0–1 produce no PvP', () => {
      expect(PVP_ZONE_CASES).toEqual([
        { zone: 0, pvpAllowed: false },
        { zone: 1, pvpAllowed: false },
        { zone: 2, pvpAllowed: true },
        { zone: 3, pvpAllowed: true },
      ]);
    });
  });

  describe('policy tree [S5.4]', () => {
    const ratio = APPENDIX_E_DEFAULTS['stance.neutral_attack_ratio'];

    it('cases follow the top-down first-match tree from GDD §8', () => {
      for (const c of POLICY_CASES) {
        expect({ name: c.name, decision: decidePolicy(c, ratio) }).toEqual({
          name: c.name,
          decision: c.expected,
        });
      }
    });

    it('pins the structural orderings the resolvers must respect', () => {
      expect(POLICY_TREE_ORDER).toEqual([
        'ally_ignore',
        'mission_forces_flee',
        'hunt_target_attack',
        'faction_stance',
        'default_ignore',
      ]);
      expect(SLOT_A_PRECEDENCE).toEqual([
        'ambushed',
        'failed_escape',
        'aggressor',
        'mission_owner',
        'equal_sen_coin_flip',
      ]);
      expect(APPENDIX_E_DEFAULTS['combat.pierce_ratio']).toBe(0.35);
      expect(APPENDIX_E_DEFAULTS['wear.scale_mode']).toBe('all_stats');
    });
  });

  describe('choke table [S5.5]', () => {
    const threshold = APPENDIX_E_DEFAULTS['wear.choke_threshold'];
    const deadAt = APPENDIX_E_DEFAULTS['wear.dead_at_or_below'];

    it('every case matches ((threshold − condition) / threshold)² and the dead rule', () => {
      for (const c of CHOKE_CASES) {
        const chance = c.condition >= threshold ? 0 : ((threshold - c.condition) / threshold) ** 2;
        expect({ condition: c.condition, chance, dead: c.condition <= deadAt }).toEqual({
          condition: c.condition,
          chance: expect.closeTo(c.chokeChance, 12),
          dead: c.dead,
        });
      }
    });

    it('pins the six GDD §9 consequence categories', () => {
      expect(CHOKE_CONSEQUENCE_CASES.map((c) => c.category)).toEqual([
        'motor',
        'battery',
        'tank',
        'shield',
        'weapon',
        'sensor',
      ]);
      expect(APPENDIX_E_DEFAULTS['wear.choke_loss_min']).toBe(3);
      expect(APPENDIX_E_DEFAULTS['wear.choke_loss_max']).toBe(8);
      expect(APPENDIX_E_DEFAULTS['failure.tank_leak_min']).toBe(0.3);
      expect(APPENDIX_E_DEFAULTS['failure.tank_leak_max']).toBe(0.5);
      expect(APPENDIX_E_DEFAULTS['failure.weapon_skip_ratio']).toBe(0.5);
    });
  });

  describe('integrity and payout tables [S5.6]', () => {
    const combatFactor = APPENDIX_E_DEFAULTS['integrity.combat_factor'];
    const envFactor = APPENDIX_E_DEFAULTS['integrity.env_factor'];
    const floorRatio = APPENDIX_E_DEFAULTS['economy.payout_floor_integrity'];

    it('every integrity case matches the approved damage formulas', () => {
      for (const c of INTEGRITY_CASES) {
        if (c.kind === 'combat') {
          const pointsLost = combatFactor * (c.hpLost / c.maxHp) * 100;
          expect({ case: c, computed: pointsLost }).toEqual({
            case: c,
            computed: expect.closeTo(c.pointsLost, 12),
          });
        } else if (c.kind === 'environment') {
          const pointsLost = envFactor * c.envNivel;
          expect({ case: c, computed: pointsLost }).toEqual({
            case: c,
            computed: expect.closeTo(c.pointsLost, 12),
          });
        } else {
          const integrity = (c.clientHp / c.clientMaxHp) * 100;
          expect({ case: c, computed: integrity }).toEqual({
            case: c,
            computed: expect.closeTo(c.integrity, 12),
          });
        }
      }
    });

    it('every payout case follows linear 100→50 and zero below the floor', () => {
      const floorPoints = floorRatio * 100;
      for (const c of PAYOUT_CASES) {
        const multiplier = c.integrity >= floorPoints ? c.integrity / 100 : 0;
        expect({ integrity: c.integrity, multiplier }).toEqual(c);
      }
    });
  });

  describe('mining table [S5.6]', () => {
    const richness = APPENDIX_E_DEFAULTS['mining.richness'];
    const rarity = APPENDIX_E_DEFAULTS['mining.rarity'];
    const floor = APPENDIX_E_DEFAULTS['wear.performance_floor'];
    const slope = APPENDIX_E_DEFAULTS['wear.performance_slope'];

    it('every case matches richness × (1 − rarity) × MIN × performance', () => {
      for (const c of MINING_CASES) {
        const performance = floor + slope * (c.minerCondition / 100);
        const chance = richness[c.env] * (1 - rarity[c.material]) * (c.minerMin * performance);
        expect({ name: c.name, chance }).toEqual({
          name: c.name,
          chance: expect.closeTo(c.chance, 12),
        });
      }
    });

    it('pins attempts per stop', () => {
      expect(APPENDIX_E_DEFAULTS['mining.attempts_per_stop']).toBe(10);
    });
  });

  describe('rescue deadline table [S6.2]', () => {
    it('deadline = round-trip at reference_mob × factor, inside the approved range', () => {
      const min = APPENDIX_E_DEFAULTS['rescue.deadline_factor_min'];
      const max = APPENDIX_E_DEFAULTS['rescue.deadline_factor_max'];
      for (const c of RESCUE_DEADLINE_CASES) {
        expect(c.factor).toBeGreaterThanOrEqual(min);
        expect(c.factor).toBeLessThanOrEqual(max);
        expect(c.deadlineSeconds).toBe(c.roundTripSecondsAtReferenceMob * c.factor);
      }
      expect(APPENDIX_E_DEFAULTS['rescue.reference_mob']).toBe(3);
    });
  });

  describe('escort share table [S5.9]', () => {
    const share = APPENDIX_E_DEFAULTS['escort.client_target_share'];

    it('client absorbs client_target_share of enemy attacks; the rest hit the player', () => {
      for (const c of ESCORT_SHARE_CASES) {
        expect(c.clientTakes).toBe(c.incomingAttacks * share);
        expect(c.playerTakes).toBe(c.incomingAttacks - c.clientTakes);
      }
    });

    it('pins the escort encounter multiplier', () => {
      expect(APPENDIX_E_DEFAULTS['escort.encounter_multiplier']).toBe(1.5);
    });
  });

  describe('ship class table [S4.2]', () => {
    it('pins the three share thresholds and the first-match precedence', () => {
      expect(APPENDIX_E_DEFAULTS['ship_class.cargo_share']).toBe(0.3);
      expect(APPENDIX_E_DEFAULTS['ship_class.pressurized_share']).toBe(0.15);
      expect(APPENDIX_E_DEFAULTS['ship_class.combat_share']).toBe(0.45);
      expect(SHIP_CLASS_PRECEDENCE).toEqual([
        'HAULER',
        'TRANSPORT',
        'WARSHIP',
        'MINER',
        'MULTIROLE',
      ]);
    });
  });
});
