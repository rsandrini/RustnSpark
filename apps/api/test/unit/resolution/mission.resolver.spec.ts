import { describe, expect, it } from '@jest/globals';
import { ESCORT_SHARE_CASES } from '../../fixtures/appendix-e.js';
import { APPENDIX_E_RULES as GAME_CONFIG_DEFAULTS } from '../../fixtures/appendix-e-rules.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import { createRng } from '../../../src/common/rng/rng.js';
import { ScriptedRng } from '../../../src/common/rng/scripted.rng.js';
import { escortAttackShare, type PartSnapshot } from '../../../src/resolution/leg/leg.resolver.js';
import {
  resolveMission,
  type MissionInput,
  type MissionSnapshot,
} from '../../../src/resolution/mission/mission.resolver.js';

const rules: GameRules = GAME_CONFIG_DEFAULTS;

const PARTS = [
  { id: 'engine-1', partClass: 'ENGINE', providesEsc: false, condition: 80 },
  { id: 'battery-1', partClass: 'BATTERY', providesEsc: false, condition: 80 },
  { id: 'tank-1', partClass: 'TANK', providesEsc: false, condition: 80 },
  { id: 'shield-1', partClass: 'DEFENSE', providesEsc: true, condition: 80 },
  { id: 'weapon-1', partClass: 'WEAPON', providesEsc: false, condition: 80 },
  { id: 'sensor-1', partClass: 'SENSOR', providesEsc: false, condition: 80 },
  { id: 'armor-1', partClass: 'DEFENSE', providesEsc: false, condition: 80 },
  { id: 'cargo-1', partClass: 'CARGO', providesEsc: false, condition: 80 },
];

function snapshot(overrides: Partial<MissionSnapshot> = {}): MissionSnapshot {
  return {
    shipId: 'ship-1',
    parts: PARTS,
    sheet: {
      pot: 40,
      pdf: 8,
      bli: 3,
      esc: 14,
      sen: 4,
      crg: 20,
      min: 0,
      hp: 145,
      mass: 40,
      energyCont: 10,
      energyCombat: 10,
      batCharge: 10,
      batOutput: 10,
      batInput: 10,
      fuelCap: 1000,
      fuelUse: 0.7,
      structureUsed: 10,
      structureBudget: 30,
      autonomy: 1428,
      mob: 2,
      condition: 80,
    },
    fuel: 1000,
    hp: 145,
    esc: 14,
    energyMode: 'FULL',
    weaponEnergyDraw: 0,
    shieldEnergyDraw: 0,
    ...overrides,
  };
}

function mission(overrides: Partial<MissionInput> = {}): MissionInput {
  return {
    id: 'm-1',
    type: 'DELIVERY',
    legs: [
      {
        distance: 800,
        danger: 0,
        zone: 1,
        env: { id: 'open', level: 1, fuelMult: 1 },
      },
    ],
    tier: 1,
    isolation: 1,
    factionRelation: 'neutral',
    relation: 'NEUTRAL',
    stance: null,
    preset: 'CRUISE',
    missionOwner: 'player',
    missionForcesFlee: false,
    objectCarried: true,
    client: null,
    ...overrides,
  };
}

function resolve(seed: number | string, snap = snapshot(), m = mission()) {
  return resolveMission({ seed, snapshot: snap, mission: m, rules });
}

describe('S5.9 — determinism', () => {
  it('same inputs twice → deep-equal outcomes', () => {
    const a = resolve('seed-a');
    const b = resolve('seed-a');
    expect(a).toEqual(b);
  });

  it('different seeds produce different event streams', () => {
    const a = resolve('seed-a');
    const b = resolve('seed-b');
    expect(JSON.stringify(a.events)).not.toBe(JSON.stringify(b.events));
  });
});

describe('S5.9 — per-leg / per-purpose RNG via child()', () => {
  it('each leg derives its own child stream from the root seed', () => {
    const twoLegs = mission({
      legs: [
        { distance: 400, danger: 0, zone: 1, env: { id: 'open', level: 1, fuelMult: 1 } },
        { distance: 400, danger: 0, zone: 1, env: { id: 'open', level: 1, fuelMult: 1 } },
      ],
    });
    const out = resolve('stream-seed', snapshot(), twoLegs);
    expect(out.legs).toHaveLength(2);
    expect(out.legs[0]?.status).toBe('completed');
    expect(out.legs[1]?.status).toBe('completed');
  });

  it('ScriptedRng.child returns the same flat tape for Layer-2 parity', () => {
    const rng = ScriptedRng.fromTape({ seqs: [], entries: [] });
    expect(rng.child('leg:0')).toBe(rng);
    expect(rng.child('choke')).toBe(rng);
  });

  it('createRng.child derives independent streams for different labels', () => {
    const root = createRng(42);
    const leg0 = root.child('leg:0');
    const leg1 = root.child('leg:1');
    // Independent seeds → independent first draws (astronomically unlikely to match).
    expect(leg0.float()).not.toBe(leg1.float());
  });
});

describe('S5.9 — fuel exhaustion → adrift, not death', () => {
  it('ends the mission ADRIFT with HP untouched when fuel is insufficient', () => {
    const out = resolve(
      'adrift-seed',
      snapshot({ fuel: 0 }),
      mission({
        legs: [{ distance: 800, danger: 0, zone: 1, env: { id: 'open', level: 1, fuelMult: 1 } }],
      }),
    );
    expect(out.status).toBe('adrift');
    expect(out.shipStatus).toBe('ADRIFT');
    expect(out.hp).toBe(145);
    expect(out.fuel).toBe(0);
    expect(out.events.some((event) => event.type === 'fuel_exhausted')).toBe(true);
    // No payment on adrift.
    expect(out.events.some((event) => event.category === 'payment')).toBe(false);
  });

  it('gravitational fuel multiplier can exhaust a borderline tank', () => {
    // fuelUse 0.7 × 800 / 100 × 1.5 = 8.4 → 8 units; tank of 4 is not enough.
    const out = resolve(
      'grav-adrift',
      snapshot({ fuel: 4 }),
      mission({
        legs: [
          {
            distance: 800,
            danger: 0,
            zone: 1,
            env: { id: 'gravitational', level: 2, fuelMult: 1.5 },
          },
        ],
      }),
    );
    expect(out.status).toBe('adrift');
    expect(out.shipStatus).toBe('ADRIFT');
    expect(out.hp).toBeGreaterThan(0);
  });
});

describe('S5.9 — motor choke aborts the leg and fails the mission', () => {
  it('motor choke → failed, fuel burned, no payment event', () => {
    // Condition 10 is far below choke threshold 30; drive the choke with a
    // scripted float of 0 (always fires when chance > 0).
    const lowMotor = PARTS.map((part) =>
      part.id === 'engine-1' ? { ...part, condition: 10 } : part,
    );
    const rngEntries = [
      { fn: 'random' as const, args: [] as const, value: 0 },
      { fn: 'uniform' as const, args: [3, 8] as const, value: 5 },
      // remaining draws unused if motor aborts before encounter/wear
    ];
    // Use production RNG with low condition — choke chance at cond 10 is
    // ((30-10)/30)^2 ≈ 0.44, so most seeds fire; find one that does.
    let aborted = false;
    for (let seed = 0; seed < 200; seed += 1) {
      const out = resolve(
        seed,
        snapshot({ parts: lowMotor, fuel: 100 }),
        mission({
          legs: [{ distance: 100, danger: 0, zone: 1, env: { id: 'open', level: 1, fuelMult: 1 } }],
        }),
      );
      if (out.status === 'failed') {
        aborted = true;
        expect(out.events.some((event) => event.type === 'motor')).toBe(true);
        expect(out.events.some((event) => event.category === 'payment')).toBe(false);
        expect(out.fuel).toBeLessThan(100);
        expect(out.hp).toBeGreaterThan(0);
        break;
      }
    }
    expect(aborted).toBe(true);
    void rngEntries;
  });

  it('a second, healthy engine keeps the leg going when the first chokes', () => {
    // engine-1 is near-dead and will choke; engine-2 is healthy (condition 80 is
    // above choke_threshold 30, so it never rolls a choke at all) and should be
    // enough on its own to keep the ship moving.
    const twoEngines = [
      ...PARTS.map((part) => (part.id === 'engine-1' ? { ...part, condition: 10 } : part)),
      { id: 'engine-2', partClass: 'ENGINE', providesEsc: false, condition: 80 },
    ];
    let sawMotorChoke = false;
    for (let seed = 0; seed < 200; seed += 1) {
      const out = resolve(
        seed,
        snapshot({ parts: twoEngines, fuel: 100 }),
        mission({
          legs: [{ distance: 100, danger: 0, zone: 1, env: { id: 'open', level: 1, fuelMult: 1 } }],
        }),
      );
      if (out.events.some((event) => event.type === 'motor')) {
        sawMotorChoke = true;
        expect(out.status).not.toBe('failed');
        expect(out.legs[0]?.status).not.toBe('motor_abort');
      }
    }
    expect(sawMotorChoke).toBe(true);
  });
});

describe('S5.9 — event shape', () => {
  it('every event has leg, category, type, actors, effects, magnitude', () => {
    const out = resolve('shape-seed');
    expect(out.events.length).toBeGreaterThan(0);
    for (const event of out.events) {
      expect(typeof event.leg).toBe('number');
      expect(['combat', 'environment', 'loot', 'failure', 'payment', 'transit']).toContain(
        event.category,
      );
      expect(typeof event.type).toBe('string');
      expect(event.actors.playerShipId).toBe('ship-1');
      expect(event.effects).toHaveProperty('hp');
      expect(event.effects).toHaveProperty('condByPart');
      expect(event.effects).toHaveProperty('credits');
      expect(event.effects).toHaveProperty('loot');
      expect(typeof event.magnitude).toBe('number');
    }
  });

  it('failure events never carry a credit effect (D13)', () => {
    const lowMotor = PARTS.map((part) =>
      part.id === 'engine-1' ? { ...part, condition: 5 } : part,
    );
    for (let seed = 0; seed < 200; seed += 1) {
      const out = resolve(
        seed,
        snapshot({ parts: lowMotor, fuel: 100 }),
        mission({
          legs: [{ distance: 100, danger: 0, zone: 1, env: { id: 'open', level: 1, fuelMult: 1 } }],
        }),
      );
      const failures = out.events.filter((event) => event.category === 'failure');
      if (failures.length > 0) {
        for (const event of failures) {
          expect(event.effects.credits).toBe(0);
        }
        return;
      }
    }
    throw new Error('expected at least one failure event across 200 seeds');
  });
});

describe('S5.9 — escort attack share (Appendix E ESCORT_SHARE_CASES)', () => {
  it('matches every pinned integer-total case', () => {
    for (const testCase of ESCORT_SHARE_CASES) {
      const share = escortAttackShare(testCase.incomingAttacks, rules);
      expect(share.clientTakes).toBe(testCase.clientTakes);
      expect(share.playerTakes).toBe(testCase.playerTakes);
    }
  });
});

describe('S5.9 — escort client destroyed fails the mission', () => {
  it('reports escort_destroyed when the client HP hits zero', () => {
    const weakClient = { shipId: 'client-1', maxHp: 1, hp: 1 };
    let destroyed = false;
    for (let seed = 0; seed < 300; seed += 1) {
      const out = resolve(
        seed,
        snapshot({ fuel: 500 }),
        mission({
          type: 'ESCORT',
          objectCarried: false,
          relation: 'HOSTILE',
          stance: 'AGGRESSIVE',
          client: weakClient,
          legs: [
            { distance: 600, danger: 10, zone: 3, env: { id: 'debris', level: 3, fuelMult: 1.1 } },
          ],
        }),
      );
      const leg = out.legs[0];
      if (leg?.status === 'escort_destroyed') {
        destroyed = true;
        expect(out.status).toBe('failed');
        expect(out.client?.hp).toBe(0);
        expect(out.events.some((event) => event.type === 'escort_client_destroyed')).toBe(true);
        // S9.0: the absorbed-damage event carries the fight's layer split too.
        const absorbed = out.events.find((event) => event.type === 'escort_absorbed');
        expect(absorbed?.cascade).toBeDefined();
        expect(absorbed?.cascade!.hp).toBeGreaterThanOrEqual(0);
        break;
      }
    }
    expect(destroyed).toBe(true);
  });
});

describe('S9.0 — event enrichment (schemaVersion 2)', () => {
  it('combat_win / combat_loss carry the {shield, armor, hp} layer split (GDD §15)', () => {
    const hostile = mission({
      relation: 'HOSTILE',
      stance: 'AGGRESSIVE',
      legs: [
        { distance: 800, danger: 10, zone: 3, env: { id: 'debris', level: 3, fuelMult: 1.1 } },
      ],
    });
    let found = false;
    for (let seed = 0; seed < 500 && !found; seed += 1) {
      const out = resolve(seed, snapshot({ fuel: 800 }), hostile);
      for (const event of out.events) {
        if (event.type !== 'combat_win' && event.type !== 'combat_loss') continue;
        const cascade = event.cascade;
        expect(cascade).toBeDefined();
        expect(Number.isInteger(cascade!.shield)).toBe(true);
        expect(Number.isInteger(cascade!.armor)).toBe(true);
        expect(Number.isInteger(cascade!.hp)).toBe(true);
        expect(cascade!.shield).toBeGreaterThanOrEqual(0);
        expect(cascade!.armor).toBeGreaterThanOrEqual(0);
        expect(cascade!.hp).toBeGreaterThanOrEqual(0);
        // No escort client here, so the hull-pool loss IS the net HP effect.
        expect(cascade!.hp).toBe(-event.effects.hp);
        if (cascade!.shield + cascade!.armor + cascade!.hp > 0) found = true;
      }
    }
    expect(found).toBe(true);
  });

  it('part-failure events carry consequence; tank leaks carry an integer fuelLost', () => {
    const weakParts = PARTS.map((part) => ({ ...part, condition: 5 }));
    const PART_FAILURES = new Set(['motor', 'battery', 'tank', 'shield', 'weapon', 'sensor']);
    let sawConsequence = false;
    let sawTankLeak = false;
    for (let seed = 0; seed < 400 && !(sawConsequence && sawTankLeak); seed += 1) {
      const out = resolve(
        seed,
        snapshot({ parts: weakParts, fuel: 500 }),
        mission({
          legs: [{ distance: 400, danger: 0, zone: 1, env: { id: 'open', level: 1, fuelMult: 1 } }],
        }),
      );
      for (const event of out.events) {
        if (!PART_FAILURES.has(event.type)) continue;
        expect(typeof event.consequence).toBe('string');
        expect(event.consequence!.length).toBeGreaterThan(0);
        sawConsequence = true;
        if (event.type === 'tank') {
          expect(Number.isInteger(event.fuelLost)).toBe(true);
          expect(event.fuelLost!).toBeGreaterThanOrEqual(0);
          sawTankLeak = true;
        } else {
          expect(event.fuelLost).toBeUndefined();
        }
      }
    }
    expect(sawConsequence).toBe(true);
    expect(sawTankLeak).toBe(true);
  });
});

describe('round-2 playtest fix — wear tracks danger, and passive parts wear far slower', () => {
  function conditionOf(id: string, parts: readonly PartSnapshot[]): number {
    return parts.find((part) => part.id === id)!.condition;
  }

  it('a simple, safe delivery (danger 0) costs even an exposed part almost nothing', () => {
    const twoSafeLegs = mission({
      legs: [
        { distance: 400, danger: 0, zone: 0, env: { id: 'open', level: 1, fuelMult: 1 } },
        { distance: 400, danger: 0, zone: 0, env: { id: 'open', level: 1, fuelMult: 1 } },
      ],
    });
    for (const seed of ['safe-a', 'safe-b', 'safe-c']) {
      const out = resolve(seed, snapshot(), twoSafeLegs);
      const last = out.legs.at(-1)!;
      for (const part of PARTS) {
        expect(80 - conditionOf(part.id, last.ship.parts)).toBeLessThan(4);
      }
    }
  });

  it('scavenging on foot: no encounter, no wear, no fuel, even on a deadly route', () => {
    const deadly = mission({
      type: 'SCAVENGE',
      objectCarried: false,
      legs: [{ distance: 400, danger: 10, zone: 3, env: { id: 'open', level: 3, fuelMult: 0 } }],
      scavenge: {
        zone: 3,
        fieldType: 'pirate',
        scrapPlace: false,
        tiers: [{ tier: 'COMMON', chance: 1 }],
        catalog: [{ partType: 'cargo', rarity: 'COMMON' }],
        onFoot: true,
      },
    });
    for (const seed of ['foot-a', 'foot-b', 'foot-c', 'foot-d']) {
      const out = resolve(seed, snapshot(), deadly);
      const leg = out.legs.at(-1)!;
      expect(out.events.some((event) => event.category === 'combat')).toBe(false);
      expect(out.events.some((event) => event.type === 'mission_wear')).toBe(false);
      for (const part of PARTS) expect(conditionOf(part.id, leg.ship.parts)).toBe(80);
      expect(leg.ship.fuel).toBe(1000);
    }
  });

  describe('engine tuning (pushed engines can fail)', () => {
    const tuned = (chem: number, seed: string, legs = 3, engineCondition = 80) => {
      const parts = PARTS.map((part) =>
        part.id === 'engine-1'
          ? { ...part, condition: engineCondition, engineGroup: 'chem' as const }
          : part,
      );
      const route = Array.from({ length: legs }, () => ({
        distance: 100,
        danger: 0,
        zone: 0,
        env: { id: 'open', level: 1, fuelMult: 1 },
      }));
      return resolve(seed, snapshot({ parts }), mission({ legs: route, engine: { chem, ion: 1 } }));
    };
    const failures = (out: ReturnType<typeof resolve>) =>
      out.events.filter((event) => event.type === 'engine_push');

    it('engines at level 1 or below never fail', () => {
      for (const seed of ['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6']) {
        expect(failures(tuned(1, seed))).toHaveLength(0);
        expect(failures(tuned(0.6, seed))).toHaveLength(0);
      }
    });

    it('pushed engines fail now and then: the engine wears, the failure is on the record, the run goes on', () => {
      let total = 0;
      for (let index = 0; index < 40; index += 1) {
        const out = tuned(rules.engine.chem_level_max, `push-${index}`, 4);
        const found = failures(out);
        total += found.length;
        for (const event of found) {
          expect(event.category).toBe('failure');
          expect(event.consequence).toBe('engine_overheat');
          expect(event.magnitude).toBeGreaterThan(0);
          expect(event.effects.condByPart['engine-1']).toBeLessThan(80);
        }
        // never an abort by itself while the engine still has condition left
        if (found.length === 1) expect(out.status).not.toBe('motor_abort');
      }
      expect(total).toBeGreaterThan(10);
    });

    it('each failure of the run costs more than the one before', () => {
      let checked = 0;
      for (let index = 0; index < 60 && checked < 3; index += 1) {
        const found = failures(tuned(rules.engine.chem_level_max, `many-${index}`, 6, 100));
        if (found.length < 2) continue;
        checked += 1;
        expect(found[1]!.magnitude).toBeGreaterThan(found[0]!.magnitude);
      }
      expect(checked).toBeGreaterThan(0);
    });

    it('every pushed or eased leg leaves a line in the log, with the level, the chance and what came of it', () => {
      const tunings = (out: ReturnType<typeof resolve>) =>
        out.events.filter((event) => event.type === 'engine_tuning');
      // pushed: one line per leg, held or failed, carrying the chance it was run with
      const pushed = tuned(1.5, 'log-1', 3);
      expect(tunings(pushed)).toHaveLength(3);
      for (const event of tunings(pushed)) {
        expect(event.category).toBe('transit');
        expect(event.tuning).toMatchObject({ group: 'chem', levelPct: 150 });
        expect(event.tuning!.chancePct).toBeGreaterThan(0);
        expect(['held', 'failed']).toContain(event.tuning!.outcome);
      }
      // a failed leg says so, and also records the engine failure itself
      const failedLegs = tunings(pushed).filter(
        (event) => event.tuning!.outcome === 'failed',
      ).length;
      expect(failures(pushed)).toHaveLength(failedLegs);
      // eased: a line per leg, no chance of failing
      const eased = tuned(0.6, 'log-2', 2);
      expect(tunings(eased)).toHaveLength(2);
      expect(tunings(eased)[0]!.tuning).toMatchObject({
        group: 'chem',
        levelPct: 60,
        chancePct: 0,
        outcome: 'eased',
      });
      // as listed: nothing to report
      expect(tunings(tuned(1, 'log-3', 2))).toHaveLength(0);
    });

    describe('pushing wears things down even when nothing fails', () => {
      // (failures switched off, so any wear seen is the push itself)
      const safe: GameRules = { ...rules, engine: { ...rules.engine, mishap_at_max: 0 } };
      const flown = (group: 'chem' | 'ion', level: number) => {
        const parts = PARTS.map((part) =>
          part.id === 'engine-1'
            ? { ...part, condition: 100, engineGroup: group }
            : { ...part, condition: 100 },
        );
        const route = Array.from({ length: 3 }, () => ({
          distance: 100,
          danger: 0,
          zone: 0,
          env: { id: 'open', level: 1, fuelMult: 1 },
        }));
        const out = resolveMission({
          seed: 'wear-seed',
          snapshot: snapshot({ parts }),
          mission: mission({
            legs: route,
            engine: { chem: group === 'chem' ? level : 1, ion: group === 'ion' ? level : 1 },
          }),
          rules: safe,
        });
        return { out, last: out.legs.at(-1)!.ship.parts };
      };
      const cond = (parts: ReadonlyArray<{ id: string; condition: number }>, id: string) =>
        parts.find((part) => part.id === id)!.condition;

      // (the journey itself wears every part a little: the push is what comes on top of the run
      // at the listed levels)
      const base = flown('chem', 1).last;

      it('a pushed chemical group wears its engine, nothing else (the batteries are not involved)', () => {
        const { out, last } = flown('chem', rules.engine.chem_level_max);
        expect(out.events.some((event) => event.type === 'engine_push')).toBe(false);
        expect(cond(base, 'engine-1') - cond(last, 'engine-1')).toBeGreaterThan(
          rules.engine.push_wear * 2,
        );
        expect(cond(last, 'battery-1')).toBeCloseTo(cond(base, 'battery-1'));
      });

      it('a pushed ion group wears the ion engine AND the batteries (less than the engine)', () => {
        const { last } = flown('ion', rules.engine.ion_level_max);
        const engineLoss = cond(base, 'engine-1') - cond(last, 'engine-1');
        const batteryLoss = cond(base, 'battery-1') - cond(last, 'battery-1');
        expect(engineLoss).toBeGreaterThan(rules.engine.push_wear * 2);
        expect(batteryLoss).toBeGreaterThan(0);
        expect(batteryLoss).toBeLessThan(engineLoss);
      });

      it('wears more the harder it is pushed, and not at all as listed or throttled down', () => {
        const loss = (level: number) =>
          cond(base, 'engine-1') - cond(flown('chem', level).last, 'engine-1');
        expect(loss(1.5)).toBeGreaterThan(loss(1.2));
        expect(loss(1.2)).toBeGreaterThan(0);
        expect(loss(1)).toBeCloseTo(0);
        expect(loss(0.6)).toBeCloseTo(0);
      });

      it('the log says so: the push line carries the wear and the parts it touched', () => {
        const { out } = flown('ion', rules.engine.ion_level_max);
        const line = out.events.find((event) => event.type === 'engine_tuning')!;
        expect(line.tuning).toMatchObject({ group: 'ion', batteries: true });
        expect(line.tuning!.wear).toBeGreaterThan(0);
        expect(Object.keys(line.effects.condByPart).sort()).toEqual(['battery-1', 'engine-1']);
      });
    });

    it('is deterministic: same seed, same failures', () => {
      const a = tuned(rules.engine.chem_level_max, 'same', 4);
      const b = tuned(rules.engine.chem_level_max, 'same', 4);
      expect(failures(a)).toEqual(failures(b));
    });
  });

  it('over many dangerous legs, an exposed part (engine) wears far more than a passive one (cargo)', () => {
    const dangerousLeg = mission({
      legs: [{ distance: 400, danger: 8, zone: 3, env: { id: 'open', level: 1, fuelMult: 1 } }],
    });
    let engineLoss = 0;
    let cargoLoss = 0;
    const runs = 40;
    for (let seed = 0; seed < runs; seed += 1) {
      const out = resolve(seed, snapshot(), dangerousLeg);
      const parts = out.legs[0]!.ship.parts;
      engineLoss += 80 - conditionOf('engine-1', parts);
      cargoLoss += 80 - conditionOf('cargo-1', parts);
    }
    // Passive stays a small, near-flat usage tick; exposed tracks the leg's own danger.
    expect(cargoLoss / runs).toBeLessThan(0.2);
    expect(engineLoss).toBeGreaterThan(cargoLoss * 5);
  });
});

describe('RACE missions', () => {
  const field = [
    { id: 'rival-1', name: 'Comet Runner', mobility: 2 },
    { id: 'rival-2', name: 'Vega Dart', mobility: 2.5 },
    { id: 'rival-3', name: 'Halo Sprint', mobility: 3 },
  ];
  const raceMission = (competitors = field) =>
    mission({ type: 'RACE', objectCarried: false, race: { competitors } });
  // The race reads the unrounded speed (pot / mass x mob_factor): shape the sheet to give `mob`.
  const withMobility = (mob: number) =>
    snapshot({
      sheet: { ...snapshot().sheet, mob, mass: 10, pot: (mob * 10) / rules.ship.mob_factor },
    });

  it('a ship faster than the whole field wins: a race_result event and the top prize', () => {
    const out = resolve('race-1', withMobility(8), raceMission());
    const result = out.events.find((event) => event.type === 'race_result');
    expect(result?.race?.place).toBe(1);
    expect(result?.race?.standings).toHaveLength(4);
    expect(out.status).toBe('success');
    const payout = out.events.find((event) => event.type === 'mission_payout');
    expect(payout?.effects.credits).toBeGreaterThan(0);
    expect(out.creditsDelta).toBeGreaterThanOrEqual(payout?.effects.credits ?? 0);
  });

  it('a slow ship finishes off the podium: no prize and a partial result', () => {
    const slowField = [1, 2, 3, 4].map((n) => ({ id: `r${n}`, name: `R${n}`, mobility: 6 }));
    const out = resolve('race-2', withMobility(1), raceMission(slowField));
    expect(out.events.find((event) => event.type === 'race_result')?.race?.place).toBe(5);
    expect(out.events.some((event) => event.type === 'mission_payout')).toBe(false);
    expect(out.status).toBe('partial_failure');
  });

  it('is deterministic, and pays 1st more than 2nd more than 3rd', () => {
    expect(resolve('race-3', withMobility(5), raceMission())).toEqual(
      resolve('race-3', withMobility(5), raceMission()),
    );
    const calm: GameRules = {
      ...rules,
      race: { ...rules.race, time_jitter: 0, form_spread: 0, mishap_chance: 0 },
    };
    const prize = (mob: number): number =>
      resolveMission({
        seed: 'prizes',
        snapshot: withMobility(mob),
        mission: raceMission(),
        rules: calm,
      }).events.find((event) => event.type === 'mission_payout')?.effects.credits ?? 0;
    expect(prize(8)).toBeGreaterThan(prize(2.8));
    expect(prize(2.8)).toBeGreaterThan(prize(2.2));
  });
});

describe('open-cargo deliveries', () => {
  it('the units beyond the minimum add to the pay, on top of the listed reward', () => {
    const payoutOf = (cargoExtra?: number) => {
      const out = resolve(
        'cargo-open',
        snapshot(),
        mission(cargoExtra === undefined ? {} : { cargoExtra }),
      );
      expect(out.status).toBe('success');
      return out.events.find((event) => event.type === 'mission_payout')?.effects.credits ?? 0;
    };
    const plain = payoutOf();
    expect(plain).toBeGreaterThan(0);
    expect(payoutOf(0)).toBe(plain);
    expect(payoutOf(100)).toBeGreaterThan(plain);
  });
});

describe("the pilot's own free mining job", () => {
  it('pays no credits and writes no payout: the ore is the whole result', () => {
    const job = mission({ type: 'MINING', unpaid: true });
    const out = resolve('own-job', snapshot(), job);
    expect(out.status).toBe('success');
    expect(out.events.some((event) => event.type === 'mission_payout')).toBe(false);
    expect(out.creditsDelta).toBe(0);
    // a paid mining mission still pays
    const paid = resolve('own-job', snapshot(), mission({ type: 'MINING' }));
    expect(paid.events.some((event) => event.type === 'mission_payout')).toBe(true);
  });
});
