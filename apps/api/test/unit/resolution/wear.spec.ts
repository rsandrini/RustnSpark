import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@jest/globals';
import { ScriptedRng } from '../../../src/common/rng/scripted.rng.js';
import { createRng } from '../../../src/common/rng/rng.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import { chokeChance, isDead, performance } from '../../../src/parts/condition.js';
import {
  FAILURE_CONSEQUENCE,
  failureCategory,
  rollChoke,
  rollChokes,
  tankLeakFraction,
  weaponSkipRatio,
  type ChokeCandidate,
  type FailureEvent,
} from '../../../src/resolution/wear/failure.resolver.js';
import {
  applyMissionWearToParts,
  applyWear,
  chokeWear,
  countDefenseParts,
  dangerFactor,
  defeatWear,
  isPassiveWearClass,
  missionWear,
  overloadWear,
  partAmbientWear,
  partDefeatWear,
  systemWear,
} from '../../../src/resolution/wear/wear.calculator.js';
import { CHOKE_CASES, CHOKE_CONSEQUENCE_CASES } from '../../fixtures/appendix-e.js';

const oracleDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/oracle',
);

interface TablesFixture {
  performance: { floor: number; slope: number; table: [number, number][] };
  choke: { threshold: number; table: [number, number][] };
  wear: {
    env_multiplier: number;
    env_table: [number, number][];
    base_min: number;
    base_max: number;
  };
}

const tables = JSON.parse(
  readFileSync(path.join(oracleDir, 'tables.json'), 'utf8'),
) as TablesFixture;

const rules: GameRules = GAME_CONFIG_DEFAULTS;

function candidate(patch: Partial<ChokeCandidate> = {}): ChokeCandidate {
  return {
    partId: 'part-1',
    partClass: 'ENGINE',
    condition: 10,
    providesEsc: false,
    ...patch,
  };
}

describe('S5.5 — wear calculator', () => {
  it('mission wear is base uniform(base_min, base_max) + env.nivel × env_multiplier', () => {
    const rng = new ScriptedRng([{ fn: 'uniform', args: [3, 5], value: 4 }], [], 'mission-wear');
    const wear = missionWear(2, rules, rng);
    expect(wear.base).toBe(4);
    expect(wear.environment).toBeCloseTo(2.4, 12);
    expect(wear.total).toBeCloseTo(6.4, 12);
    expect(wear.base).toBeGreaterThanOrEqual(rules.wear.base_min);
    expect(wear.base).toBeLessThan(rules.wear.base_max);
    rng.assertDrained();
  });

  it('matches the oracle env table (nivel × 1.2) for every level', () => {
    expect(rules.wear.env_multiplier).toBe(tables.wear.env_multiplier);
    expect(rules.wear.base_min).toBe(tables.wear.base_min);
    expect(rules.wear.base_max).toBe(tables.wear.base_max);
    for (const [nivel, expected] of tables.wear.env_table) {
      const rng = new ScriptedRng([{ fn: 'uniform', args: [3, 5], value: 3 }], [], `env-${nivel}`);
      const wear = missionWear(nivel, rules, rng);
      expect({ nivel, environment: wear.environment }).toEqual({
        nivel,
        environment: expected,
      });
      rng.assertDrained();
    }
  });

  it('overload wear is an integer in 8–15 (GDD §9)', () => {
    const rng = new ScriptedRng([{ fn: 'randint', args: [8, 15], value: 12 }], [], 'overload');
    expect(overloadWear(rules, rng)).toBe(12);
    rng.assertDrained();
    for (let seed = 0; seed < 50; seed += 1) {
      const loss = overloadWear(rules, createRng(seed));
      expect(loss).toBeGreaterThanOrEqual(8);
      expect(loss).toBeLessThanOrEqual(15);
    }
  });

  it('choke wear draws uniform(choke_loss_min, choke_loss_max)', () => {
    const rng = new ScriptedRng([{ fn: 'uniform', args: [3, 8], value: 5.5 }], [], 'choke-wear');
    expect(chokeWear(rules, rng)).toBe(5.5);
    rng.assertDrained();
    for (let seed = 0; seed < 50; seed += 1) {
      const loss = chokeWear(rules, createRng(seed));
      expect(loss).toBeGreaterThanOrEqual(3);
      expect(loss).toBeLessThan(8);
    }
  });

  it('defeat wear draws uniform(defeat_loss_min, defeat_loss_max)', () => {
    const rng = new ScriptedRng([{ fn: 'uniform', args: [8, 15], value: 10 }], [], 'defeat-wear');
    expect(defeatWear(rules, rng)).toBe(10);
    rng.assertDrained();
    for (let seed = 0; seed < 50; seed += 1) {
      const loss = defeatWear(rules, createRng(seed));
      expect(loss).toBeGreaterThanOrEqual(8);
      expect(loss).toBeLessThan(15);
    }
  });

  it('applyWear clamps condition at 0', () => {
    expect(applyWear(10, 3)).toBe(7);
    expect(applyWear(2, 5)).toBe(0);
    expect(applyWear(0, 1)).toBe(0);
  });

  it('applies independent mission wear to each part', () => {
    const rng = new ScriptedRng(
      [
        { fn: 'uniform', args: [3, 5], value: 4 },
        { fn: 'uniform', args: [3, 5], value: 5 },
      ],
      [],
      'per-part-wear',
    );
    const next = applyMissionWearToParts(
      [
        { id: 'a', condition: 50 },
        { id: 'b', condition: 20 },
      ],
      0,
      rules,
      rng,
    );
    expect(next.get('a')).toBe(46);
    expect(next.get('b')).toBe(15);
    rng.assertDrained();
  });
});

describe('round-2 playtest fix — passive classes wear from usage only, exposed classes scale by danger', () => {
  it('bridge, cargo, reactor and utility are the passive classes; everything else is exposed', () => {
    expect(isPassiveWearClass('BRIDGE')).toBe(true);
    expect(isPassiveWearClass('CARGO')).toBe(true);
    expect(isPassiveWearClass('REACTOR')).toBe(true);
    expect(isPassiveWearClass('UTILITY')).toBe(true);
    for (const exposed of ['ENGINE', 'TANK', 'BATTERY', 'WEAPON', 'DEFENSE', 'SENSOR']) {
      expect(isPassiveWearClass(exposed)).toBe(false);
    }
  });

  it('dangerFactor scales linearly between the floor and the cap', () => {
    expect(dangerFactor(0, rules)).toBe(rules.wear.danger_floor);
    expect(dangerFactor(rules.wear.danger_ref, rules)).toBeCloseTo(1, 12);
    expect(dangerFactor(1000, rules)).toBe(rules.wear.danger_cap);
  });

  it('systemWear draws uniform(system_base_min, system_base_max), tiny and unscaled', () => {
    const rng = new ScriptedRng(
      [
        {
          fn: 'uniform',
          args: [rules.wear.system_base_min, rules.wear.system_base_max],
          value: 0.1,
        },
      ],
      [],
      'system-wear',
    );
    expect(systemWear(rules, rng)).toBe(0.1);
    rng.assertDrained();
  });

  it('partAmbientWear routes a passive class to systemWear, ignoring danger and environment', () => {
    const rng = new ScriptedRng(
      [
        {
          fn: 'uniform',
          args: [rules.wear.system_base_min, rules.wear.system_base_max],
          value: 0.12,
        },
      ],
      [],
      'passive-ambient',
    );
    // A high-danger, high-env leg still costs the passive class only its flat usage tick.
    expect(partAmbientWear('CARGO', 8, 3, 0, rules, rng)).toBe(0.12);
    rng.assertDrained();
  });

  it('partAmbientWear scales an exposed class by the leg danger', () => {
    const rng = new ScriptedRng([{ fn: 'uniform', args: [3, 5], value: 4 }], [], 'exposed-ambient');
    // total = 4 + 1×1.2 = 5.2; danger 0 floors at danger_floor (0.1) → 0.52.
    expect(partAmbientWear('ENGINE', 0, 1, 0, rules, rng)).toBeCloseTo(
      5.2 * rules.wear.danger_floor,
      10,
    );
    rng.assertDrained();
  });

  it("a simple, safe leg (low danger) barely touches an exposed part — the owner's complaint", () => {
    // Two legs at danger 2 (zone 0, the mildest), env level 1: with the shipped defaults this
    // must cost an exposed part a small fraction of what the old flat formula did (~4-6/leg).
    let condition = 80;
    for (let i = 0; i < 2; i += 1) {
      const rng = createRng(1000 + i);
      const loss = partAmbientWear('ENGINE', 2, 1, 0, rules, rng);
      condition = applyWear(condition, loss);
    }
    expect(80 - condition).toBeLessThan(4);
  });

  it('partDefeatWear gives a passive class only system_defeat_share of the roll; exposed the whole roll with no DEFENSE part installed', () => {
    expect(partDefeatWear('CARGO', 12, 0, rules)).toBeCloseTo(
      12 * rules.wear.system_defeat_share,
      10,
    );
    expect(partDefeatWear('ENGINE', 12, 0, rules)).toBe(12);
  });

  it('countDefenseParts counts only DEFENSE-class parts', () => {
    expect(
      countDefenseParts([
        { partClass: 'DEFENSE' },
        { partClass: 'ENGINE' },
        { partClass: 'DEFENSE' },
        { partClass: 'CARGO' },
      ]),
    ).toBe(2);
    expect(countDefenseParts([{ partClass: 'ENGINE' }])).toBe(0);
    expect(countDefenseParts([])).toBe(0);
  });

  // Round-4 wear rework: DEFENSE absorbs a fixed total extra share, split across however many
  // DEFENSE parts exist; every other exposed class absorbs correspondingly less.
  it('partDefeatWear: one DEFENSE part gets the full bonus, other exposed classes get the compensating factor', () => {
    expect(partDefeatWear('DEFENSE', 12, 1, rules)).toBeCloseTo(
      12 * (1 + rules.wear.defense_wear_bonus),
      10,
    );
    expect(partDefeatWear('ENGINE', 12, 1, rules)).toBeCloseTo(
      12 * rules.wear.other_exposed_wear_factor,
      10,
    );
    // Passive classes are untouched by a DEFENSE part being installed.
    expect(partDefeatWear('CARGO', 12, 1, rules)).toBeCloseTo(
      12 * rules.wear.system_defeat_share,
      10,
    );
  });

  it('partDefeatWear: two DEFENSE parts split the same total bonus, not double it', () => {
    const oneDefense = partDefeatWear('DEFENSE', 12, 1, rules);
    const twoDefenseEach = partDefeatWear('DEFENSE', 12, 2, rules);
    expect(twoDefenseEach).toBeCloseTo(12 * (1 + rules.wear.defense_wear_bonus / 2), 10);
    expect(twoDefenseEach).toBeLessThan(oneDefense);
    // Collective extra absorbed (beyond the 1x baseline) stays the same either way.
    const oneDefenseTotalExtra = oneDefense - 12;
    const twoDefenseTotalExtra = 2 * twoDefenseEach - 2 * 12;
    expect(twoDefenseTotalExtra).toBeCloseTo(oneDefenseTotalExtra, 10);
  });

  it('partAmbientWear: a DEFENSE part absorbs more, an other exposed class absorbs less, same roll', () => {
    const baseRng = () =>
      new ScriptedRng([{ fn: 'uniform', args: [3, 5], value: 4 }], [], 'defense-ambient');
    // total = 4 + 1×1.2 = 5.2, danger 6 → dangerFactor 1 (danger/danger_ref = 6/6 = 1).
    const noDefense = partAmbientWear('ENGINE', 6, 1, 0, rules, baseRng());
    const withDefense = partAmbientWear('DEFENSE', 6, 1, 1, rules, baseRng());
    const otherExposedWithDefense = partAmbientWear('ENGINE', 6, 1, 1, rules, baseRng());
    expect(withDefense).toBeCloseTo(noDefense * (1 + rules.wear.defense_wear_bonus), 10);
    expect(otherExposedWithDefense).toBeCloseTo(noDefense * rules.wear.other_exposed_wear_factor, 10);
  });
});

describe('S5.5 — performance and choke tables (exact)', () => {
  it('performance matches the 101-row oracle table', () => {
    expect(rules.wear.performance_floor).toBe(tables.performance.floor);
    expect(rules.wear.performance_slope).toBe(tables.performance.slope);
    for (const [condition, expected] of tables.performance.table) {
      expect({ condition, value: performance(condition, rules) }).toEqual({
        condition,
        value: expect.closeTo(expected, 12),
      });
    }
  });

  it('choke chance matches the 101-row oracle table', () => {
    expect(rules.wear.choke_threshold).toBe(tables.choke.threshold);
    for (const [condition, expected] of tables.choke.table) {
      expect({ condition, value: chokeChance(condition, rules) }).toEqual({
        condition,
        value: expect.closeTo(expected, 12),
      });
    }
  });

  it('every CHOKE_CASES row matches the implementation', () => {
    for (const c of CHOKE_CASES) {
      expect({
        condition: c.condition,
        chance: chokeChance(c.condition, rules),
        dead: isDead(c.condition, rules),
      }).toEqual({
        condition: c.condition,
        chance: expect.closeTo(c.chokeChance, 12),
        dead: c.dead,
      });
    }
  });

  it('parts at or below 1% are dead', () => {
    expect(isDead(1, rules)).toBe(true);
    expect(isDead(0, rules)).toBe(true);
    expect(isDead(2, rules)).toBe(false);
    expect(rules.wear.dead_at_or_below).toBe(1);
  });
});

describe('S5.5 — failure consequences (GDD §9 / Appendix E)', () => {
  it('maps every CHOKE_CONSEQUENCE_CASES row to the same consequence', () => {
    for (const c of CHOKE_CONSEQUENCE_CASES) {
      const category = failureCategory(c.partClass, c.partClass === 'DEFENSE');
      expect({ partClass: c.partClass, category }).toEqual({
        partClass: c.partClass,
        category: c.category,
      });
      expect(category).not.toBeNull();
      expect(FAILURE_CONSEQUENCE[category!]).toBe(c.consequence);
    }
  });

  it('DEFENSE without ESC (armor plate) is not choke-critical', () => {
    expect(failureCategory('DEFENSE', false)).toBeNull();
    expect(failureCategory('CARGO', false)).toBeNull();
    expect(failureCategory('BRIDGE', false)).toBeNull();
    expect(failureCategory('REACTOR', false)).toBeNull();
    expect(failureCategory('UTILITY', false)).toBeNull();
  });

  it('weapon jam skips half the attacks (failure.weapon_skip_ratio)', () => {
    expect(weaponSkipRatio(rules)).toBe(0.5);
    expect(FAILURE_CONSEQUENCE.weapon).toBe('weapon_skips_half_attacks');
  });

  it('tank leak takes 30–50% of remaining fuel', () => {
    const rng = new ScriptedRng([{ fn: 'uniform', args: [0.3, 0.5], value: 0.4 }], [], 'tank-leak');
    expect(tankLeakFraction(rules, rng)).toBe(0.4);
    rng.assertDrained();
    for (let seed = 0; seed < 50; seed += 1) {
      const fraction = tankLeakFraction(rules, createRng(seed));
      expect(fraction).toBeGreaterThanOrEqual(0.3);
      expect(fraction).toBeLessThan(0.5);
    }
    expect(rules.failure.tank_leak_min).toBe(0.3);
    expect(rules.failure.tank_leak_max).toBe(0.5);
  });

  it('a failure event never carries a credit effect', () => {
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.0 },
        { fn: 'uniform', args: [3, 8], value: 4 },
      ],
      [],
      'no-credits',
    );
    const event = rollChoke(candidate({ condition: 10 }), rules, rng);
    expect(event).not.toBeNull();
    const failure = event!;
    expect(failure.category).toBe('failure');
    expect(Object.keys(failure)).not.toContain('credits');
    expect(Object.keys(failure)).not.toContain('creditEffect');
    for (const key of Object.keys(failure)) {
      expect(key).not.toMatch(/credit/i);
    }
    // Exhaustive shape: every key is mechanical.
    expect(Object.keys(failure).sort()).toEqual(
      ['category', 'consequence', 'conditionAfter', 'conditionLost', 'partId', 'type'].sort(),
    );
    rng.assertDrained();
  });

  it('tank failure carries fuelLost but still no credits', () => {
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.0 },
        { fn: 'uniform', args: [3, 8], value: 5 },
        { fn: 'uniform', args: [0.3, 0.5], value: 0.5 },
      ],
      [],
      'tank-event',
    );
    const failure = rollChoke(
      candidate({ partClass: 'TANK', condition: 20, remainingFuel: 1000 }),
      rules,
      rng,
    );
    expect(failure).toMatchObject({
      category: 'failure',
      type: 'tank',
      consequence: 'fuel_leak',
      conditionLost: 5,
      conditionAfter: 15,
      fuelLost: 500,
    });
    expect(Object.keys(failure!)).not.toContain('credits');
    rng.assertDrained();
  });
});

describe('S5.5 — choke rolls', () => {
  it('does not roll at or above the choke threshold (no RNG draw)', () => {
    const rng = new ScriptedRng([], [], 'above-threshold');
    expect(rollChoke(candidate({ condition: 30 }), rules, rng)).toBeNull();
    expect(rollChoke(candidate({ condition: 100 }), rules, rng)).toBeNull();
    rng.assertDrained();
  });

  it('does not roll a dead part (≤1%) and draws no RNG', () => {
    const rng = new ScriptedRng([], [], 'dead-part');
    expect(rollChoke(candidate({ condition: 1 }), rules, rng)).toBeNull();
    expect(rollChoke(candidate({ condition: 0 }), rules, rng)).toBeNull();
    rng.assertDrained();
  });

  it('fires when the choke roll succeeds and applies choke loss', () => {
    // condition 10 → chance ≈ 0.444; float 0.1 < chance → fires.
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.1 },
        { fn: 'uniform', args: [3, 8], value: 6 },
      ],
      [],
      'choke-hit',
    );
    const event = rollChoke(candidate({ condition: 10 }), rules, rng);
    expect(event).toMatchObject({
      type: 'motor',
      consequence: 'leg_aborted_mission_failed',
      conditionLost: 6,
      conditionAfter: 4,
    });
    rng.assertDrained();
  });

  it('misses when the choke roll fails', () => {
    // float 0.9 ≥ chance at condition 10 (≈0.444) → no event, no loss draw.
    const rng = new ScriptedRng([{ fn: 'random', args: [], value: 0.9 }], [], 'choke-miss');
    expect(rollChoke(candidate({ condition: 10 }), rules, rng)).toBeNull();
    rng.assertDrained();
  });

  it('rolls each candidate in order and returns only the fired chokes', () => {
    const candidates: ChokeCandidate[] = [
      candidate({ partId: 'engine', partClass: 'ENGINE', condition: 10 }),
      candidate({ partId: 'cargo', partClass: 'CARGO', condition: 5 }),
      candidate({ partId: 'battery', partClass: 'BATTERY', condition: 20 }),
    ];
    // engine fires, cargo is non-critical (no draw), battery misses.
    const rng = new ScriptedRng(
      [
        { fn: 'random', args: [], value: 0.1 },
        { fn: 'uniform', args: [3, 8], value: 3 },
        { fn: 'random', args: [], value: 0.95 },
      ],
      [],
      'batch',
    );
    const events = rollChokes(candidates, rules, rng);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ partId: 'engine', type: 'motor' });
    rng.assertDrained();
  });

  it('every failure event is category failure with a pinned consequence code', () => {
    const classes: readonly [string, boolean, FailureEvent['type'], FailureEvent['consequence']][] =
      [
        ['ENGINE', false, 'motor', 'leg_aborted_mission_failed'],
        ['BATTERY', false, 'battery', 'shield_offline_for_leg'],
        ['DEFENSE', true, 'shield', 'next_hit_bypasses_shield'],
        ['WEAPON', false, 'weapon', 'weapon_skips_half_attacks'],
        ['SENSOR', false, 'sensor', 'guaranteed_ambush'],
      ];
    for (const [partClass, providesEsc, type, consequence] of classes) {
      const rng = new ScriptedRng(
        [
          { fn: 'random', args: [], value: 0 },
          { fn: 'uniform', args: [3, 8], value: 3 },
        ],
        [],
        `class-${partClass}`,
      );
      const event = rollChoke(
        candidate({ partId: partClass, partClass, providesEsc, condition: 10 }),
        rules,
        rng,
      );
      expect({ partClass, event }).toEqual({
        partClass,
        event: expect.objectContaining({
          category: 'failure',
          type,
          consequence,
        }),
      });
      rng.assertDrained();
    }
  });
});
