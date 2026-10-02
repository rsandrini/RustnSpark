import { describe, expect, it } from '@jest/globals';
import { ESCORT_SHARE_CASES } from '../../fixtures/appendix-e.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
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
