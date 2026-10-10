import { describe, expect, it } from '@jest/globals';
import { createRng } from '../../../src/common/rng/rng.js';
import { APPENDIX_E_RULES as GAME_CONFIG_DEFAULTS } from '../../fixtures/appendix-e-rules.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import {
  resolveMission,
  type MissionInput,
  type MissionSnapshot,
} from '../../../src/resolution/mission/mission.resolver.js';
import { resolveCombat } from '../../../src/resolution/combat/combat.resolver.js';
import type { CombatSheet } from '../../../src/resolution/combat/combat.types.js';
import {
  applyHit,
  armorReduction,
  environmentDamage,
  settleLosses,
  type DamageLayers,
} from '../../../src/resolution/damage/layers.js';

const rules: GameRules = GAME_CONFIG_DEFAULTS;

const layers = (over: Partial<DamageLayers> = {}): DamageLayers => ({
  hp: 100,
  esc: 14,
  armor: 20,
  spill: 0,
  hpMax: 100,
  armorMax: 20,
  settled: { hp: 100, armor: 20, spill: 0 },
  ...over,
});

describe('armor cuts a hit by a flat amount, then its pool soaks the rest', () => {
  // armor pool 40 = rating 8 (pool factor 5): a flat cut of 8 x 0.25 = 2 per hit
  const armored = (over: Partial<DamageLayers> = {}) =>
    layers({ esc: 0, armor: 40, armorMax: 40, ...over });

  it('cuts a flat amount from every hit that gets past the shield', () => {
    expect(armorReduction(40, 10, rules.combat)).toBeCloseTo(2);
    expect(armorReduction(40, 4, rules.combat)).toBeCloseTo(2);
  });

  it('never cuts more than its share of the hit, so nothing is immune', () => {
    expect(armorReduction(400, 4, rules.combat)).toBeCloseTo(4 * rules.combat.armor_reduction_max_share);
  });

  it('cuts less as the armor wears or runs down, and nothing once it is gone', () => {
    expect(armorReduction(20, 10, rules.combat)).toBeCloseTo(1);
    expect(armorReduction(0, 10, rules.combat)).toBe(0);
  });

  it('a hit: the shield first, the cut next (the pool pays nothing for it), the pool soaks the rest, the hull takes what remains', () => {
    const hit = applyHit(armored({ esc: 4 }), 10, rules.combat);
    // 4 to the shield, 6 left: armor cuts 2 for free and its pool soaks the other 4
    expect(hit).toMatchObject({ shield: 4, reduced: 2, armor: 6, hull: 0, spill: 0 });
    expect(hit.layers).toMatchObject({ esc: 0, armor: 36, hp: 100 });
  });

  it('with the pool used up the armor is gone: the hull takes the whole hit', () => {
    const hit = applyHit(armored({ armor: 0 }), 9, rules.combat);
    expect(hit).toMatchObject({ reduced: 0, armor: 0, hull: 9 });
  });

  it('the cut keeps working while the pool is nearly spent: only the soak runs out', () => {
    const hit = applyHit(armored({ armor: 1 }), 10, rules.combat);
    // rating left 0.2 => cut 0.05; pool soaks its last 1; the rest reaches the hull
    expect(hit.reduced).toBeCloseTo(0.05);
    expect(hit.layers.armor).toBe(0);
    expect(hit.hull).toBeCloseTo(10 - 0.05 - 1);
  });

  it('without the combat rules (older callers) it is the plain pool', () => {
    const hit = applyHit(armored(), 10);
    expect(hit).toMatchObject({ reduced: 0, armor: 10, hull: 0 });
    expect(hit.layers.armor).toBe(30);
  });

  it('in a fight: an armored ship lasts longer under the same attacker than a bare one', () => {
    const attacker: CombatSheet = { pdf: 6, bli: 0, esc: 0, sen: 1, hp: 80, mob: 2 };
    const bare: CombatSheet = { pdf: 0, bli: 0, esc: 0, sen: 1, hp: 80, mob: 2, armor: 0 };
    const plated: CombatSheet = { pdf: 0, bli: 8, esc: 0, sen: 1, hp: 80, mob: 2, armor: 8 * rules.combat.armor_pool_factor };
    // (a fight runs until one side retreats, so what differs is how many rounds it takes)
    const roundsToBreak = (target: CombatSheet) => {
      let rounds = 0;
      for (let i = 0; i < 40; i += 1) {
        rounds += resolveCombat(attacker, target, rules.combat, createRng(`armor-${i}`)).rounds.length;
      }
      return rounds;
    };
    expect(roundsToBreak(plated)).toBeGreaterThan(roundsToBreak(bare));
    // and the log of a round says how much the armor cut
    const out = resolveCombat(attacker, plated, rules.combat, createRng('armor-log'));
    const hits = out.rounds.filter((round) => round.attacker === 'A' && round.hit);
    expect(hits.length).toBeGreaterThan(0);
    // the first hit meets fresh armor, so it is cut; later ones are cut less as the pool runs down
    expect(hits[0]!.armorReduced ?? 0).toBeGreaterThan(0);
    expect(hits[0]!.armorAbsorbed).toBeGreaterThanOrEqual(hits[0]!.armorReduced ?? 0);
  });
});

describe('armor-piercing weapons (lasers) skip the armor cut', () => {
  const plated: CombatSheet = {
    pdf: 0,
    bli: 8,
    esc: 0,
    sen: 1,
    hp: 80,
    mob: 2,
    armor: 8 * rules.combat.armor_pool_factor,
  };
  const firstHit = (attacker: CombatSheet) => {
    for (let i = 0; i < 60; i += 1) {
      const out = resolveCombat(attacker, plated, rules.combat, createRng(`pierce-${i}`));
      const hit = out.rounds.find((round) => round.attacker === 'A' && round.hit);
      if (hit !== undefined) return hit;
    }
    throw new Error('no hit in 60 fights');
  };

  it('a fully piercing attacker is never cut, a half piercing one is cut half as much', () => {
    const base: CombatSheet = { pdf: 6, bli: 0, esc: 0, sen: 1, hp: 80, mob: 2 };
    const normal = firstHit(base);
    const piercing = firstHit({ ...base, pierceShare: 1 });
    const half = firstHit({ ...base, pierceShare: 0.5 });
    expect(normal.armorReduced ?? 0).toBeGreaterThan(0);
    expect(piercing.armorReduced ?? 0).toBe(0);
    expect(half.armorReduced ?? 0).toBeGreaterThan(0);
    expect(half.armorReduced ?? 0).toBeLessThan(normal.armorReduced ?? 0);
  });
});

describe('applyHit: shield, then armor, then hull, then the parts', () => {
  it('the shield takes everything it can', () => {
    const hit = applyHit(layers(), 9);
    expect(hit).toMatchObject({ shield: 9, armor: 0, hull: 0, spill: 0 });
    expect(hit.layers).toMatchObject({ esc: 5, armor: 20, hp: 100 });
  });

  it('what the shield cannot take goes to armor, then to the hull', () => {
    const hit = applyHit(layers(), 40);
    // 14 shield + 20 armor, 6 left for the hull
    expect(hit).toMatchObject({ shield: 14, armor: 20, hull: 6, spill: 0 });
    expect(hit.layers).toMatchObject({ esc: 0, armor: 0, hp: 94 });
  });

  it('with no shield and no armor the hull takes it all', () => {
    const hit = applyHit(layers({ esc: 0, armor: 0 }), 7);
    expect(hit).toMatchObject({ shield: 0, armor: 0, hull: 7 });
  });

  it('only what the hull cannot take spills onto the parts', () => {
    const hit = applyHit(layers({ esc: 0, armor: 0, hp: 5 }), 12);
    expect(hit).toMatchObject({ hull: 5, spill: 7 });
    expect(hit.layers.spill).toBe(7);
  });
});

describe('settleLosses: damage becomes wear on the parts, evenly', () => {
  const parts = [
    { id: 'bridge', condition: 100 },
    { id: 'engine', condition: 100 },
    { id: 'plate', condition: 100, providesArmor: true },
  ];

  it('hull lost wears every part alike (nothing is spared, nothing singled out)', () => {
    const settled = settleLosses(parts, layers({ hp: 80 }), rules);
    const conditions = settled.parts.map((part) => part.condition);
    // 20 of 100 hull lost, at the default half share: 10% worn, on all of them
    expect(conditions[0]).toBeCloseTo(90);
    expect(conditions[1]).toBeCloseTo(90);
    expect(conditions[2]).toBeCloseTo(90);
  });

  it('armor lost wears the armor parts on top', () => {
    const settled = settleLosses(parts, layers({ armor: 10 }), rules);
    expect(settled.parts[0]!.condition).toBe(100);
    // half the armor pool gone, at the same half share as the hull: a quarter worn
    expect(settled.parts[2]!.condition).toBeCloseTo(75);
  });

  it('a loss is written back once: settling again changes nothing', () => {
    const once = settleLosses(parts, layers({ hp: 80 }), rules);
    const twice = settleLosses(once.parts, layers({ hp: 80, settled: once.settled }), rules);
    expect(twice.parts.map((part) => part.condition)).toEqual(
      once.parts.map((part) => part.condition),
    );
  });

  it('what spilled past the hull wears every part on top', () => {
    const settled = settleLosses(parts, layers({ hp: 0, spill: 10 }), rules);
    // 100 hull lost at half share (50%) and 10% spilled over that
    expect(settled.parts[0]!.condition).toBeCloseTo(100 * 0.5 * 0.9);
  });
});

describe('environmentDamage', () => {
  it('grows with the route danger and the environment, and is eased for mining', () => {
    const roll = (danger: number, env: number, scale = 1) =>
      environmentDamage(danger, env, rules, createRng('env'), scale);
    expect(roll(10, 2)).toBeGreaterThan(roll(2, 2));
    expect(roll(6, 3)).toBeGreaterThan(roll(6, 1));
    expect(roll(6, 2, 0.5)).toBeCloseTo(roll(6, 2) * 0.5);
  });
});

const ship = (over: Partial<CombatSheet> = {}): CombatSheet => ({
  pdf: 6,
  bli: 0,
  esc: 14,
  sen: 4,
  hp: 100,
  mob: 1,
  armor: 20,
  escMax: 14,
  escRegen: 3,
  escRegenEnergy: 2,
  ...over,
});
const striker: CombatSheet = { pdf: 12, bli: 0, esc: 0, sen: 9, hp: 100, mob: 1, armor: 0 };
const quiet: GameRules['combat'] = { ...rules.combat, kite_factor: 0, retreat_hp_ratio: 0.05 };

describe('layered combat', () => {
  it('shield, then armor, then hull — and the log says how much each took', () => {
    const result = resolveCombat(striker, ship(), quiet, createRng('layers'));
    const hits = result.rounds.filter((round) => round.attacker === 'A' && round.damage > 0);
    expect(hits.length).toBeGreaterThan(2);
    for (const hit of hits) {
      const hull = hit.damage - hit.shieldAbsorbed - hit.armorAbsorbed;
      expect(hull).toBeGreaterThanOrEqual(0);
      // armor only takes what the shield could not
      if (hit.armorAbsorbed > 0) expect(hit.shieldAbsorbed).toBeLessThanOrEqual(14);
      // the hull is only touched once armor is gone
      if (hull > 0) expect(hit.armorAfter).toBe(0);
    }
    expect(result.final.armB).toBeLessThanOrEqual(20);
  });

  it('a shield recovers its own regen per round and nothing more', () => {
    const result = resolveCombat(striker, ship({ esc: 0, escRegen: 3, escRegenEnergy: 0 }), quiet, createRng('regen'));
    const firstHit = result.rounds.find((round) => round.attacker === 'A' && round.hit);
    // starts empty; one round of recovery = 3 points to soak with
    expect(firstHit?.shieldAbsorbed).toBeLessThanOrEqual(3);
  });

  it('recovery is paid in combat energy: with none to spend, the shield stays down', () => {
    const noEnergy = ship({
      esc: 0,
      escRegen: 3,
      escRegenEnergy: 2,
      energyMode: 'BATTERY',
      batOutput: 0,
      energyCont: 0,
    });
    const result = resolveCombat(striker, noEnergy, quiet, createRng('no-energy'));
    expect(result.final.escB).toBe(0);
    const powered = resolveCombat(
      striker,
      { ...noEnergy, batOutput: 6 },
      quiet,
      createRng('no-energy'),
    );
    // 6 energy a round at 2 per point: the full 3 points come back every round
    expect(powered.rounds.some((round) => round.shieldAbsorbed > 0)).toBe(true);
  });

  it('the old model is untouched for a ship without an armor pool', () => {
    const legacy: CombatSheet = { pdf: 6, bli: 2, esc: 14, sen: 4, hp: 100, mob: 1 };
    const oldStriker: CombatSheet = { pdf: 12, bli: 0, esc: 0, sen: 9, hp: 100, mob: 1 };
    const result = resolveCombat(oldStriker, legacy, quiet, createRng('legacy'));
    expect(result.rounds.every((round) => round.armorAfter === undefined)).toBe(true);
  });
});

describe('batteries are a real store', () => {
  const gunner = (over: Partial<CombatSheet> = {}): CombatSheet => ({
    pdf: 6,
    bli: 0,
    esc: 0,
    sen: 9,
    hp: 400,
    mob: 1,
    armor: 0,
    energyMode: 'BATTERY',
    batOutput: 10,
    energyCont: 0,
    weaponEnergyDraw: 5,
    battery: 20,
    ...over,
  });
  const target: CombatSheet = { pdf: 0, bli: 0, esc: 0, sen: 0, hp: 400, mob: 1, armor: 0 };
  const long: GameRules['combat'] = { ...rules.combat, kite_factor: 0, retreat_hp_ratio: 0.01 };

  it('every shot takes energy out of the battery until it is empty, then the weapon goes quiet', () => {
    const result = resolveCombat(gunner(), target, long, createRng('drain'));
    // 20 stored at 5 a shot: four shots in all, then nothing
    const shots = result.rounds.filter((round) => round.attacker === 'A');
    expect(shots).toHaveLength(4);
    expect(result.final.batA).toBe(0);
  });

  it('the ship\'s spare power pays first, so the battery lasts longer', () => {
    const solo = resolveCombat(gunner(), target, long, createRng('spare'));
    const helped = resolveCombat(
      gunner({ energyMode: 'FULL', energyCont: 3 }),
      target,
      long,
      createRng('spare'),
    );
    expect(helped.rounds.filter((round) => round.attacker === 'A').length).toBeGreaterThan(
      solo.rounds.filter((round) => round.attacker === 'A').length,
    );
  });

  it('with no stored figure the battery is inexhaustible, as before', () => {
    const { battery: _stored, ...legacy } = gunner();
    const result = resolveCombat(legacy, target, long, createRng('legacy'));
    expect(result.rounds.filter((round) => round.attacker === 'A').length).toBeGreaterThan(10);
  });
});

describe('power-starved systems', () => {
  const target: CombatSheet = { pdf: 0, bli: 0, esc: 0, sen: 0, hp: 400, mob: 1, armor: 0 };
  const long: GameRules['combat'] = { ...rules.combat, kite_factor: 0, retreat_hp_ratio: 0.01 };
  const gunner = (over: Partial<CombatSheet> = {}): CombatSheet => ({
    pdf: 6, bli: 0, esc: 10, sen: 9, hp: 400, mob: 1, armor: 0, escMax: 10, escRegen: 3, ...over,
  });

  it('a weapon with no power never fires; with full power it always does', () => {
    const dark = resolveCombat(gunner({ weaponPower: 0 }), target, long, createRng('w0'));
    expect(dark.rounds.filter((round) => round.attacker === 'A')).toHaveLength(0);
    const lit = resolveCombat(gunner({ weaponPower: 1 }), target, long, createRng('w1'));
    expect(lit.rounds.filter((round) => round.attacker === 'A').length).toBeGreaterThan(5);
  });

  it('a weapon with partial power fires only part of the time', () => {
    const shots = (power: number) =>
      resolveCombat(gunner({ weaponPower: power }), target, long, createRng('w-half')).rounds.filter(
        (round) => round.attacker === 'A',
      ).length;
    expect(shots(0.5)).toBeLessThan(shots(1));
    expect(shots(0.5)).toBeGreaterThan(0);
  });

  it('a shield with no power does not recover', () => {
    const striker: CombatSheet = { pdf: 12, bli: 0, esc: 0, sen: 1, hp: 400, mob: 1, armor: 0 };
    const result = resolveCombat(
      striker,
      { ...gunner({ esc: 0, shieldPower: 0 }), esc: 0 },
      long,
      createRng('s0'),
    );
    expect(result.final.escB).toBe(0);
  });
});

describe('a whole run in the layered model', () => {
  const PARTS = [
    { id: 'bridge', partClass: 'BRIDGE', providesEsc: false, condition: 100 },
    { id: 'engine', partClass: 'ENGINE', providesEsc: false, condition: 100 },
    { id: 'cargo', partClass: 'CARGO', providesEsc: false, condition: 100 },
    { id: 'plate', partClass: 'DEFENSE', providesEsc: false, providesArmor: true, condition: 100 },
  ];
  const snap = (over: Partial<MissionSnapshot> = {}): MissionSnapshot => ({
    shipId: 's',
    parts: PARTS,
    sheet: {
      pot: 40, pdf: 0, bli: 4, esc: 0, sen: 4, crg: 10, min: 0, hp: 100, mass: 20,
      energyCont: 0, energyCombat: 0, batCharge: 0, batOutput: 0, batInput: 0,
      fuelCap: 1000, fuelUse: 1, structureUsed: 5, structureBudget: 60, autonomy: 0, mob: 2,
      condition: 100,
    },
    fuel: 1000,
    hp: 100,
    esc: 0,
    energyMode: 'FULL',
    weaponEnergyDraw: 0,
    shieldEnergyDraw: 0,
    armor: 20,
    escRegen: 0,
    escRegenEnergy: 0,
    ...over,
  });
  const trip = (danger: number): MissionInput => ({
    id: 'm',
    type: 'DELIVERY',
    legs: [{ distance: 400, danger, zone: 0, env: { id: 'open', level: 2, fuelMult: 1 } }],
    tier: 1,
    isolation: 1,
    factionRelation: 'neutral',
    relation: 'NEUTRAL',
    stance: null,
    preset: 'CRUISE',
    missionOwner: 'player',
    missionForcesFlee: false,
    objectCarried: false,
    client: null,
  });

  it('the journey hurts every part alike: the cargo hold is not spared, the engine not singled out', () => {
    // a route with no pirates: only the journey's own damage
    const quietRules = { ...rules, encounter: { ...rules.encounter, chance_divisor: 100000 } };
    const out = resolveMission({ seed: 'quiet', snapshot: snap(), mission: trip(12), rules: quietRules });
    const byId = new Map(out.parts.map((part) => [part.id, part.condition]));
    expect(byId.get('bridge')).toBeLessThan(100);
    // every part that is not armor loses the same share
    expect(byId.get('engine')).toBeCloseTo(byId.get('bridge') ?? 0, 5);
    expect(byId.get('cargo')).toBeCloseTo(byId.get('bridge') ?? 0, 5);
    // the armor plate paid for what the armor pool took, on top
    expect(byId.get('plate')).toBeLessThan(byId.get('bridge') ?? 0);
  });

  it('a calmer route hurts less than a dangerous one', () => {
    const quietRules = { ...rules, encounter: { ...rules.encounter, chance_divisor: 100000 } };
    const calm = resolveMission({ seed: 'z', snapshot: snap(), mission: trip(1), rules: quietRules });
    const rough = resolveMission({ seed: 'z', snapshot: snap(), mission: trip(14), rules: quietRules });
    const cond = (out: typeof calm) => out.parts.find((part) => part.id === 'bridge')?.condition ?? 0;
    expect(cond(calm)).toBeGreaterThan(cond(rough));
  });

  it('scavenging is manual work at the place: the ship takes no journey damage', () => {
    const quietRules = { ...rules, encounter: { ...rules.encounter, chance_divisor: 100000 } };
    const dig = { ...trip(12), type: 'SCAVENGE' as const };
    const out = resolveMission({ seed: 'dig', snapshot: snap(), mission: dig, rules: quietRules });
    expect(out.parts.every((part) => part.condition === 100)).toBe(true);
    expect(out.events.some((event) => event.type === 'mission_wear')).toBe(false);
  });

  it('mined ore rides in the cargo space: past it the rest stays behind, and the report says so', () => {
    const quietRules = {
      ...rules,
      encounter: { ...rules.encounter, chance_divisor: 100000 },
      mining: { ...rules.mining, attempts_per_stop: 40 },
    };
    const dig: MissionInput = {
      ...trip(2),
      type: 'MINING',
      mining: {
        stop: { env: 'debris', materialId: 'common_ore', materialRarity: 'common' },
        miner: { min: 5, condition: 100 },
      },
    };
    const mined = (crg: number) => {
      const base = snap();
      const out = resolveMission({
        seed: 'ore',
        snapshot: { ...base, sheet: { ...base.sheet, crg, min: 5 } },
        mission: dig,
        rules: quietRules,
      });
      return {
        units: out.loot.reduce((sum, entry) => sum + entry.quantity, 0),
        full: out.events.find((event) => event.type === 'mining_cargo_full'),
      };
    };
    const roomy = mined(100);
    expect(roomy.units).toBeGreaterThan(3);
    expect(roomy.full).toBeUndefined();
    const tight = mined(3);
    expect(tight.units).toBe(3);
    expect(tight.full?.magnitude).toBe(roomy.units - 3);
  });

  it('the journey\'s hit is recorded by the layer that took it', () => {
    const quietRules = { ...rules, encounter: { ...rules.encounter, chance_divisor: 100000 } };
    const out = resolveMission({ seed: 'layers', snapshot: snap(), mission: trip(12), rules: quietRules });
    const wear = out.events.find((event) => event.type === 'mission_wear');
    expect(wear?.cascade).toBeDefined();
    // no shield on this ship: it is the armor that took it first
    expect(wear?.cascade?.shield).toBe(0);
    expect(wear?.cascade?.armor).toBeGreaterThan(0);
  });

  it('the old model is unchanged for a snapshot without pools', () => {
    const legacy = snap();
    const { armor: _a, escRegen: _r, escRegenEnergy: _e, ...rest } = legacy;
    const out = resolveMission({ seed: 'old', snapshot: rest, mission: trip(6), rules });
    expect(out.parts.length).toBe(4);
  });
});
