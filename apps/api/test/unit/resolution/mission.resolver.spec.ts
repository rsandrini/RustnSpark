import { describe, expect, it } from '@jest/globals';
import { ESCORT_SHARE_CASES } from '../../fixtures/appendix-e.js';
import { APPENDIX_E_RULES as GAME_CONFIG_DEFAULTS } from '../../fixtures/appendix-e-rules.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import { createRng } from '../../../src/common/rng/rng.js';
import { ScriptedRng } from '../../../src/common/rng/scripted.rng.js';
import { escortAttackShare, type PartSnapshot } from '../../../src/resolution/leg/leg.resolver.js';
import { missionReward } from '../../../src/missions/mission.reward.js';
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
      pax: 0,
      lifeCap: 0,
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

describe('a won fight leaves scrap behind', () => {
  const hostile = mission({
    relation: 'HOSTILE',
    stance: 'AGGRESSIVE',
    legs: [{ distance: 800, danger: 10, zone: 3, env: { id: 'debris', level: 3, fuelMult: 1.1 } }],
  });
  const withScrap = (most: number): GameRules => ({
    ...rules,
    combat: { ...rules.combat, scrap_win_min: 1, scrap_win_max: most },
  });
  const scrapEvents = (events: ReturnType<typeof resolve>['events']) =>
    events.filter((event) => event.type === 'scavenge_find' && event.found?.kind === 'scrap');

  it("drops 1 to 2 pieces of the ship's own part types per win, and nothing when turned off", () => {
    const snap = snapshot({ fuel: 800, scrapTypes: ['engine_chem_small', 'cargo'] });
    let wins = 0;
    for (let seed = 0; seed < 300 && wins < 5; seed += 1) {
      const on = resolveMission({ seed, snapshot: snap, mission: hostile, rules: withScrap(2) });
      const winCount = on.events.filter((event) => event.type === 'combat_win').length;
      if (winCount === 0) continue;
      wins += 1;
      const pieces = scrapEvents(on.events);
      expect(pieces.length).toBeGreaterThanOrEqual(winCount);
      expect(pieces.length).toBeLessThanOrEqual(winCount * 2);
      for (const piece of pieces) {
        expect(['engine_chem_small', 'cargo']).toContain(piece.found?.partType);
      }
      const off = resolveMission({ seed, snapshot: snap, mission: hostile, rules: withScrap(0) });
      expect(scrapEvents(off.events)).toHaveLength(0);
    }
    expect(wins).toBeGreaterThan(0);
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
    // the race is stored leg by leg: one standing per leg, the last one is the final order
    const legs = result?.race?.legs;
    expect(legs).toHaveLength(raceMission().legs.length);
    expect(legs?.[legs.length - 1]?.standings.map((row) => row.totalSeconds)).toEqual(
      result?.race?.standings.map((row) => row.seconds),
    );
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
      race: { ...rules.race, time_jitter: 0, mishap_chance: 0 },
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

  it('a hop of seconds pays a tenth of the extra too, not the full 200 a unit (owner playtest 2026-10-22)', () => {
    const hop = (cargoExtra: number) => {
      const out = resolve(
        'cargo-hop',
        snapshot(),
        mission({
          cargoExtra,
          legs: [{ distance: 30, danger: 0, zone: 1, env: { id: 'open', level: 1, fuelMult: 1 } }],
        }),
      );
      return out.events.find((event) => event.type === 'mission_payout')?.effects.credits ?? 0;
    };
    const factor = rules.missions.short_trip_reward_factor;
    expect(hop(400) - hop(0)).toBeLessThanOrEqual(400 * factor + 1);
  });
});

describe('passenger head count pays on top of the base', () => {
  it('a group of five pays more than none, and the figure is the board figure of the same tier', () => {
    const payoutOf = (passengers?: number) => {
      const out = resolve(
        'pax-pay',
        snapshot(),
        mission({ type: 'TRANSPORT', ...(passengers === undefined ? {} : { passengers }) }),
      );
      expect(out.status).toBe('success');
      return out.events.find((event) => event.type === 'mission_payout')?.effects.credits ?? 0;
    };
    const plain = payoutOf();
    const five = payoutOf(5);
    expect(five).toBeGreaterThan(plain);
    expect(payoutOf(1)).toBe(plain);
    // the payout is the board figure times the ship's integrity: the group's share is the same ratio
    const boardAt = (passengers: number) =>
      missionReward(
        { legs: mission().legs as never, type: 'TRANSPORT', cargo: { passengers } },
        1,
        rules,
      );
    expect(five / plain).toBeCloseTo(boardAt(5) / boardAt(1), 1);
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

describe('the mining dig (v0.1.3): rarity mix, one-trip ore space, contracts', () => {
  // K = 2 and a drill of 5 in open space (richness 1): about 10 finds per 5-minute tick.
  const richRules: GameRules = {
    ...rules,
    mining: { ...rules.mining, richness: { open: 1 }, yield_k: 2, job_fuel_per_tick: 50 },
  };
  const ORES = [
    { id: 'iron', rarity: 'common', price: 200 },
    { id: 'gems', rarity: 'rare', price: 2000 },
  ];
  interface DigOptions {
    readonly miningTicks?: number;
    readonly digTicks?: number;
    readonly crg?: number;
    readonly fuelUse?: number;
    readonly ores?: typeof ORES;
    readonly contract?: { materialId: string; required: number; pay?: number };
    readonly rarity?: string;
    readonly min?: number;
    readonly seed?: string;
  }
  const dig = (options: DigOptions = {}) => {
    const {
      miningTicks,
      digTicks,
      crg = 20,
      fuelUse,
      ores = ORES,
      contract,
      rarity,
      min = 5,
    } = options;
    const job = mission({
      type: 'MINING',
      unpaid: contract === undefined,
      legs: [
        {
          distance: 100,
          danger: 0,
          zone: 1,
          env: { id: 'open', level: 1, fuelMult: 0 },
          ...(miningTicks === undefined ? {} : { miningTicks }),
          ...(digTicks === undefined ? {} : { digTicks }),
        },
      ],
      mining: {
        stop: { env: 'open', materialId: ores[0]!.id, materialRarity: 'common', ores },
        miner: { min, condition: 100, ...(rarity === undefined ? {} : { rarity }) },
      },
      ...(contract === undefined
        ? {}
        : {
            contractedMining: {
              materialId: contract.materialId,
              requiredQuantity: contract.required,
              ...(contract.pay === undefined ? {} : { pay: contract.pay }),
            },
          }),
    });
    const snap = snapshot({
      sheet: { ...snapshot().sheet, crg, ...(fuelUse === undefined ? {} : { fuelUse }) },
    });
    return resolveMission({
      seed: options.seed ?? 'dig',
      snapshot: snap,
      mission: job,
      rules: richRules,
    });
  };
  const oreOf = (out: ReturnType<typeof dig>, id?: string) =>
    out.loot
      .filter((entry) => id === undefined || entry.materialId === id)
      .reduce((sum, entry) => sum + entry.quantity, 0);
  const eventsOf = (out: ReturnType<typeof dig>, type: string) =>
    out.events.filter((event) => event.type === type);
  const droppedOf = (out: ReturnType<typeof dig>) =>
    eventsOf(out, 'mining_dropped').reduce((sum, event) => sum + event.magnitude, 0);

  it('runs every tick of a free job when the space has room, and burns fuel for each', () => {
    const out = dig({ miningTicks: 2, crg: 100 });
    expect(out.legs[0]?.miningTicksRun).toBe(2);
    expect(oreOf(out)).toBeGreaterThan(0);
    expect(droppedOf(out)).toBe(0);
    expect(out.fuel).toBe(1000 - 2 * 50);
  });

  it('the ore space is one trip whatever the time: a 20 min job keeps no more than a 5 min one could', () => {
    // cargo 6 -> ore space 12
    const long = dig({ miningTicks: 4, crg: 6 });
    const short = dig({ miningTicks: 1, crg: 6 });
    expect(long.legs[0]?.miningTicksRun).toBe(4);
    expect(oreOf(long)).toBe(12);
    expect(oreOf(short)).toBeLessThanOrEqual(12);
    expect(droppedOf(long)).toBeGreaterThan(0);
    expect(out(long)).toBe(true);
    function out(o: typeof long) {
      return oreOf(o) + droppedOf(o) > 12;
    }
  });

  it('over the space the cheapest ore goes first: found = kept + dropped, and the rare is kept before the common', () => {
    const run = dig({ miningTicks: 4, crg: 3, rarity: 'LEGENDARY', min: 20 });
    const space = 6;
    expect(oreOf(run)).toBe(space);
    const foundRare = oreOf(run, 'gems') + droppedFor(run, 'gems');
    // every rare found fits (6 places) unless more than 6 were found
    expect(oreOf(run, 'gems')).toBe(Math.min(foundRare, space));
    function droppedFor(o: typeof run, id: string) {
      return eventsOf(o, 'mining_dropped')
        .filter((event) => event.effects.loot[0]?.materialId === id)
        .reduce((sum, event) => sum + event.magnitude, 0);
    }
  });

  it('a place with one ore yields only that ore', () => {
    const run = dig({ miningTicks: 2, crg: 100, ores: [ORES[1]!] });
    expect(oreOf(run, 'iron')).toBe(0);
    expect(oreOf(run, 'gems')).toBeGreaterThan(0);
  });

  it('a dig that finds nothing says so', () => {
    const none: GameRules = {
      ...richRules,
      mining: { ...richRules.mining, richness: { open: 0 } },
    };
    const run = resolveMission({
      seed: 'dig',
      snapshot: snapshot(),
      mission: mission({
        type: 'MINING',
        unpaid: true,
        legs: [
          {
            distance: 100,
            danger: 0,
            zone: 1,
            env: { id: 'open', level: 1, fuelMult: 0 },
            miningTicks: 2,
          },
        ],
        mining: {
          stop: { env: 'open', materialId: 'iron', materialRarity: 'common', ores: ORES },
          miner: { min: 5, condition: 100 },
        },
      }),
      rules: none,
    });
    expect(oreOf(run)).toBe(0);
    expect(eventsOf(run, 'mining_empty')).toHaveLength(1);
  });

  it('a ship whose engines burn no fuel (ion only) digs for free', () => {
    const run = dig({ miningTicks: 2, crg: 100, fuelUse: 0 });
    expect(run.legs[0]?.miningTicksRun).toBe(2);
    expect(run.fuel).toBe(1000);
  });

  it('a contract stops as soon as the contracted ore is reached', () => {
    const run = dig({
      digTicks: 8,
      crg: 100,
      ores: [ORES[0]!],
      contract: { materialId: 'iron', required: 8 },
    });
    expect(run.legs[0]?.miningTicksRun).toBeLessThan(8);
    // the amount was reached (and handed over): the contract is paid in full
    expect(eventsOf(run, 'mining_paid')).toHaveLength(1);
  });

  it('a contract the drill cannot reach digs the whole time allowed and brings what it found', () => {
    const run = dig({
      digTicks: 2,
      crg: 100,
      ores: [ORES[0]!],
      contract: { materialId: 'iron', required: 500 },
    });
    expect(run.legs[0]?.miningTicksRun).toBe(2);
    expect(oreOf(run, 'iron')).toBeLessThan(500);
  });

  it('the contract ore is kept before any other ore when the space is short', () => {
    const run = dig({
      digTicks: 4,
      crg: 4,
      rarity: 'LEGENDARY',
      min: 20,
      contract: { materialId: 'iron', required: 6 },
    });
    // ore space 8: six iron are reserved even though the rare ore is dearer
    expect(eventsOf(run, 'mining_paid')).toHaveLength(1);
  });

  it('is deterministic: the dry run at dispatch and the real run agree', () => {
    expect(dig({ miningTicks: 4 })).toEqual(dig({ miningTicks: 4 }));
  });

  describe('contract settlement: delivered ore, proportional pay', () => {
    const foundOf = (out: ReturnType<typeof dig>, id: string) =>
      eventsOf(out, 'mining')
        .filter((event) => event.effects.loot[0]?.materialId === id)
        .reduce((sum, event) => sum + event.magnitude, 0);
    const iron = [ORES[0]!];

    it('the full amount pays the whole contract and hands the contracted ore over (surplus stays)', () => {
      const out = dig({
        digTicks: 8,
        crg: 100,
        ores: iron,
        contract: { materialId: 'iron', required: 8, pay: 1000 },
      });
      expect(out.creditsDelta).toBe(1000);
      expect(eventsOf(out, 'mining_paid')).toHaveLength(1);
      // the report says how much ore was handed over
      const delivered = eventsOf(out, 'mining_delivered');
      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.magnitude).toBe(8);
      expect(delivered[0]?.effects.loot).toEqual([{ materialId: 'iron', quantity: 8 }]);
      expect(oreOf(out, 'iron')).toBe(foundOf(out, 'iron') - 8);
    });

    it('less than the amount pays a share, delivers all of it and is a partial failure', () => {
      const out = dig({
        digTicks: 1,
        crg: 100,
        ores: iron,
        contract: { materialId: 'iron', required: 500, pay: 1000 },
      });
      const found = foundOf(out, 'iron');
      expect(found).toBeGreaterThan(0);
      expect(out.creditsDelta).toBe(Math.round((1000 * found) / 500));
      expect(out.status).toBe('partial_failure');
      expect(eventsOf(out, 'mining_partial_failure')).toHaveLength(1);
      expect(oreOf(out, 'iron')).toBe(0);
      // everything found of the contracted ore is handed over, short of the amount
      expect(eventsOf(out, 'mining_delivered')[0]?.magnitude).toBe(found);
    });

    it('nothing delivered pays nothing', () => {
      const dry: GameRules = {
        ...richRules,
        mining: { ...richRules.mining, richness: { open: 0 } },
      };
      const out = resolveMission({
        seed: 'dig',
        snapshot: snapshot(),
        mission: mission({
          type: 'MINING',
          legs: [
            {
              distance: 100,
              danger: 0,
              zone: 1,
              env: { id: 'open', level: 1, fuelMult: 0 },
              digTicks: 2,
            },
          ],
          mining: {
            stop: { env: 'open', materialId: 'iron', materialRarity: 'common', ores: iron },
            miner: { min: 5, condition: 100 },
          },
          contractedMining: { materialId: 'iron', requiredQuantity: 5, pay: 1000 },
        }),
        rules: dry,
      });
      expect(out.creditsDelta).toBe(0);
      expect(out.status).toBe('partial_failure');
      // nothing delivered: no delivery line
      expect(eventsOf(out, 'mining_delivered')).toHaveLength(0);
    });

    it('other ores found during the contract stay with the pilot', () => {
      const out = dig({
        digTicks: 8,
        crg: 100,
        contract: { materialId: 'iron', required: 5, pay: 1000 },
      });
      expect(oreOf(out, 'gems')).toBe(foundOf(out, 'gems'));
    });
  });

  it('a board mining mission with no ticks digs its one stop', () => {
    const run = dig({});
    expect(run.legs[0]?.miningTicksRun).toBeUndefined();
    expect(oreOf(run)).toBeGreaterThan(0);
    expect(run.fuel).toBe(1000);
  });
});

describe('P0 review — a lost fight wears the bridge', () => {
  const withBridge = (): MissionSnapshot =>
    snapshot({
      fuel: 800,
      parts: [
        ...PARTS,
        { id: 'bridge-1', partClass: 'BRIDGE', providesEsc: false, condition: 100 },
      ],
    });
  const route = (zone: number) =>
    mission({
      relation: 'HOSTILE',
      stance: 'AGGRESSIVE',
      legs: [{ distance: 800, danger: 10, zone, env: { id: 'debris', level: 3, fuelMult: 1.1 } }],
    });
  const wearRules = (minZone: number): GameRules => ({
    ...rules,
    combat: { ...rules.combat, loss_bridge_wear: 15, loss_bridge_wear_min_zone: minZone },
  });
  const bridgeAfter = (seed: number, zone: number, minZone: number): number | undefined => {
    const out = resolveMission({
      seed,
      snapshot: withBridge(),
      mission: route(zone),
      rules: wearRules(minZone),
    });
    if (!out.events.some((event) => event.type === 'combat_loss')) return undefined;
    return out.parts.find((part) => part.id === 'bridge-1')?.condition;
  };

  it('costs the bridge condition in a zone at or above the minimum, and spares it below', () => {
    let checked = 0;
    for (let seed = 0; seed < 600 && checked < 3; seed += 1) {
      const worn = bridgeAfter(seed, 3, 2);
      if (worn === undefined) continue;
      checked += 1;
      // The same lost fight on a route below the minimum zone leaves the bridge alone.
      const spared = bridgeAfter(seed, 3, 3);
      expect(worn).toBeLessThanOrEqual(100 - 15);
      expect(spared).toBeDefined();
      // minZone 3 equals the route's zone 3, so it applies too: use a higher minimum to spare it.
      const protectedBridge = resolveMission({
        seed,
        snapshot: withBridge(),
        mission: route(1),
        rules: wearRules(2),
      }).parts.find((part) => part.id === 'bridge-1')?.condition;
      expect(protectedBridge === undefined || protectedBridge > 85).toBe(true);
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('P2 review — a lost fight costs by zone', () => {
  const hostile = (zone: number) =>
    mission({
      relation: 'HOSTILE',
      stance: 'AGGRESSIVE',
      legs: [{ distance: 800, danger: 10, zone, env: { id: 'debris', level: 3, fuelMult: 1.1 } }],
    });
  const withScale = (scale: Record<string, number>): GameRules => ({
    ...rules,
    combat: { ...rules.combat, loss_bridge_wear: 0, loss_wear_scale: scale },
  });
  const lostWear = (seed: number, scale: Record<string, number>, zone: number): number | null => {
    const out = resolveMission({
      seed,
      snapshot: snapshot({ fuel: 800 }),
      mission: hostile(zone),
      rules: withScale(scale),
    });
    if (!out.events.some((event) => event.type === 'combat_loss')) return null;
    return out.parts.reduce((sum, part) => sum + (80 - part.condition), 0);
  };

  it('takes the configured share of the condition a lost fight cost', () => {
    let compared = 0;
    for (let seed = 0; seed < 800 && compared < 3; seed += 1) {
      const full = lostWear(seed, { '3': 1 }, 3);
      const tenth = lostWear(seed, { '3': 0.1 }, 3);
      if (full === null || tenth === null || full <= 5) continue;
      compared += 1;
      expect(tenth).toBeLessThan(full);
      expect(tenth).toBeLessThanOrEqual(full * 0.25);
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('a zone with no entry takes all of it, like before', () => {
    for (let seed = 0; seed < 400; seed += 1) {
      const none = lostWear(seed, {}, 2);
      const one = lostWear(seed, { '2': 1 }, 2);
      expect(none).toEqual(one);
    }
  });
});

describe('the explore scan (last leg), paid by the share covered', () => {
  const PAY = 1000;
  const sureCore: GameRules = {
    ...rules,
    economy: {
      ...rules.economy,
      core_drops: {
        ...rules.economy.core_drops,
        mission: { '3': [{ material: 'core_fragment', chance: 1, quantity: 1 }] },
      },
    },
  };
  const legs = (lastTicks: number | undefined, zone = 1) =>
    [0, 1, 2].map((n) => ({
      distance: 100,
      danger: 0,
      zone,
      env: { id: 'open', level: 1, fuelMult: 1 },
      ...(n === 2 && lastTicks !== undefined ? { scanTicks: lastTicks } : {}),
    }));
  interface ScanOptions {
    readonly area?: number;
    readonly strength?: number;
    readonly ticks?: number;
    readonly zone?: number;
    readonly fuelUse?: number;
    readonly withExplore?: boolean;
    readonly seed?: string;
    /** Layered power: the ship's generation, against a radar that asks for 10. */
    readonly supply?: number;
  }
  const layered = (supply: number): Partial<MissionSnapshot> => ({
    armor: 10,
    parts: [
      ...PARTS,
      {
        id: 'radar-p',
        partClass: 'SENSOR',
        providesEsc: false,
        condition: 80,
        power: { id: 'radar-p', kind: 'sensor', demand: 10, idle: 0, supply: 0 },
      },
      {
        id: 'gen-p',
        partClass: 'UTILITY',
        providesEsc: false,
        condition: 80,
        power: { id: 'gen-p', kind: 'other', demand: 0, idle: 0, supply },
      },
    ],
  });
  const scan = (options: ScanOptions = {}) => {
    const { area = 60, strength = 4, ticks = 10, zone = 1, fuelUse, withExplore = true } = options;
    return resolveMission({
      seed: options.seed ?? 'scan',
      snapshot: snapshot({
        sheet: { ...snapshot().sheet, ...(fuelUse === undefined ? {} : { fuelUse }) },
        ...(options.supply === undefined ? {} : layered(options.supply)),
      }),
      mission: mission({
        type: 'EXPLORE',
        legs: legs(ticks, zone),
        ...(withExplore ? { explore: { area, pay: PAY, scanner: { strength } } } : {}),
      }),
      rules: sureCore,
    });
  };
  const of = (out: ReturnType<typeof scan>, type: string) =>
    out.events.filter((event) => event.type === type);

  it('scans on the last leg only', () => {
    const scanned = of(scan(), 'explore_scanned');
    expect(scanned).toHaveLength(1);
    expect(scanned[0]?.leg).toBe(2);
    expect(scanned[0]?.magnitude).toBe(60);
    expect(scanned[0]?.category).toBe('loot');
  });

  it('full scan pays the stored reward and rolls the mission core drops', () => {
    const out = scan({ zone: 3 });
    expect(of(out, 'explore_paid')[0]?.effects.credits).toBe(PAY);
    expect(out.creditsDelta).toBe(PAY);
    expect(out.status).toBe('success');
    expect(of(out, 'core_drop')).toHaveLength(1);
  });

  it('short scan pays the share, is a partial failure and drops nothing', () => {
    const out = scan({ area: 80, ticks: 12, zone: 3 });
    expect(of(out, 'explore_scanned')[0]?.magnitude).toBe(72);
    expect(of(out, 'explore_partial_failure')[0]?.effects.credits).toBe(Math.round(PAY * 0.9));
    expect(of(out, 'explore_paid')).toHaveLength(0);
    expect(out.status).toBe('partial_failure');
    expect(of(out, 'core_drop')).toHaveLength(0);
  });

  it('a dead radar or an empty area scans nothing and pays nothing, without NaN', () => {
    for (const out of [scan({ strength: 0 }), scan({ area: 0 })]) {
      expect(of(out, 'explore_scanned')).toHaveLength(0);
      expect(of(out, 'explore_empty')).toHaveLength(1);
      expect(out.legs[2]?.scanned).toBe(0);
      expect(out.creditsDelta).toBe(0);
      expect(Number.isNaN(out.creditsDelta)).toBe(false);
      expect(out.status).toBe('partial_failure');
      expect(of(out, 'core_drop')).toHaveLength(0);
    }
  });

  it('a radar short of power covers less than at full power (the sensor share, not the rig)', () => {
    const full = scan({ supply: 10 });
    expect(of(full, 'explore_scanned')[0]?.magnitude).toBe(60);
    // 80% of its need: 70% of the time, 4 x 1.5 x 0.7 = 4.2 per tick, 10 ticks = 42
    const short = scan({ supply: 8 });
    expect(of(short, 'explore_scanned')[0]?.magnitude).toBe(42);
    expect(of(short, 'explore_partial_failure')[0]?.effects.credits).toBe(Math.round(PAY * 0.7));
    expect(short.status).toBe('partial_failure');
  });

  it('a radar under the success curve covers nothing, burns every planned tick and pays 0', () => {
    const full = scan({ supply: 10 });
    const dark = scan({ supply: 4, zone: 3 });
    expect(of(dark, 'explore_scanned')).toHaveLength(0);
    expect(of(dark, 'explore_empty')).toHaveLength(1);
    expect(dark.legs[2]?.scanned).toBe(0);
    expect(of(dark, 'explore_partial_failure')[0]?.effects.credits).toBe(0);
    expect(dark.creditsDelta).toBe(0);
    expect(dark.status).toBe('partial_failure');
    expect(of(dark, 'core_drop')).toHaveLength(0);
    // the 10 planned ticks of fuel are burned all the same
    expect(dark.fuel).toBe(full.fuel);
  });

  it('stops early when the area is covered: only the ticks run burn fuel', () => {
    const planned12 = scan({ ticks: 12, fuelUse: 0.7 });
    const none = scan({ ticks: 12, fuelUse: 0.7, withExplore: false });
    expect(none.fuel - planned12.fuel).toBe(10 * rules.explore.fuel_per_tick);
  });

  it('scan fuel is burned for ticks run, ion ships burn none', () => {
    const burned = (fuelUse: number) =>
      scan({ withExplore: false, fuelUse }).fuel - scan({ fuelUse }).fuel;
    expect(burned(0.7)).toBe(10 * rules.explore.fuel_per_tick);
    expect(burned(0)).toBe(0);
  });

  it('the same seed with and without explore leaves the other events identical', () => {
    const other = (out: ReturnType<typeof scan>) =>
      out.events.filter((event) => !/^explore_|^mission_payout$|^core_drop$/.test(event.type));
    const withScan = scan({ seed: 'same' });
    const without = scan({ seed: 'same', withExplore: false });
    expect(other(withScan)).toEqual(other(without));
    expect(withScan.legs.map((leg) => leg.encounter)).toEqual(
      without.legs.map((leg) => leg.encounter),
    );
  });
});
