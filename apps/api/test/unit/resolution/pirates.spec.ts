import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import { createRng } from '../../../src/common/rng/rng.js';
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

import { rollPirateDemand } from '../../../src/resolution/encounter/pirate-motive.js';
import { generatePirate } from '../../../src/resolution/encounter/pirate.generator.js';

const DANGEROUS = [
  { distance: 400, danger: 20, zone: 3, env: { id: 'open', level: 1, fuelMult: 1 } },
  { distance: 400, danger: 20, zone: 3, env: { id: 'open', level: 1, fuelMult: 1 } },
];
const STORAGE = [
  { id: 'spare-1', partType: 'cargo' },
  { id: 'spare-2', partType: 'hull' },
  { id: 'spare-3', partType: 'tank_small' },
];

function run(seed: number, over: Partial<MissionInput> = {}, storage = STORAGE) {
  return resolveMission({
    seed: `w1-${seed}`,
    snapshot: snapshot({ storage }),
    mission: mission({ legs: DANGEROUS, ...over }),
    rules,
  });
}
const types = (seeds: number, over: Partial<MissionInput> = {}) =>
  Array.from({ length: seeds }, (_, seed) => run(seed, over)).flatMap((outcome) =>
    outcome.events.map((event) => event.type),
  );

// W1 (round 2): danger has to show up. A pirate is hostile to everyone and always attacks, whatever
// the employer thinks of the player's faction, so a certain encounter (danger 20 / divisor 20) is a
// fight or a flight, never silence.
describe('pirates and danger (W1)', () => {
  it('a certain encounter always leaves a trace: a fight or an escape, never nothing', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const outcome = run(seed);
      const contacts = outcome.events.filter((event) =>
        ['combat_win', 'combat_loss', 'escaped'].includes(event.type),
      );
      expect(contacts.length).toBeGreaterThan(0);
    }
  });

  it('with a NEUTRAL employer relation the pirates still fight (the bug: they were "ignored")', () => {
    const seen = new Set(types(60, { relation: 'NEUTRAL', factionRelation: 'neutral' }));
    expect(seen.has('combat_win') || seen.has('combat_loss')).toBe(true);
  });

  it('a delivery that flees escapes some of the time and fights the rest', () => {
    const seen = new Set(types(120, { missionForcesFlee: true }));
    expect(seen.has('escaped')).toBe(true);
    expect(seen.has('combat_loss') || seen.has('combat_win')).toBe(true);
  });

  it('the wear event reports the condition really lost (it used to say 0)', () => {
    const worn = Array.from({ length: 20 }, (_, seed) => run(seed)).flatMap((outcome) =>
      outcome.events.filter((event) => event.type === 'mission_wear'),
    );
    expect(worn.some((event) => event.magnitude > 0)).toBe(true);
  });

  it('a lost fight names what the pirates wanted; stolen parts come from storage only', () => {
    const demands = Array.from({ length: 200 }, (_, seed) => run(seed)).flatMap((outcome) =>
      outcome.events.filter((event) => event.type === 'pirate_demand'),
    );
    expect(demands.length).toBeGreaterThan(0);
    const motives = new Set(demands.map((event) => event.motive));
    expect(motives.size).toBeGreaterThan(1);
    for (const event of demands) {
      expect(['cargo', 'parts', 'territory']).toContain(event.motive);
      for (const id of event.stolen ?? []) {
        expect(STORAGE.map((part) => part.id)).toContain(id);
      }
      expect(event.magnitude).toBe((event.stolen ?? []).length);
      if (event.motive !== 'parts') expect(event.stolen).toEqual([]);
    }
  });

  it('cannot take cargo that is not aboard, nor storage parts that do not exist', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const outcome = run(seed, { objectCarried: false }, []);
      for (const event of outcome.events.filter((entry) => entry.type === 'pirate_demand')) {
        expect(event.motive).toBe('territory');
      }
    }
  });

  it('is deterministic: the same seed steals the same parts', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      expect(run(seed)).toEqual(run(seed));
    }
  });

  it('a part is never stolen twice across legs', () => {
    for (let seed = 0; seed < 300; seed += 1) {
      const ids = run(seed, { objectCarried: false }).events.flatMap((event) => event.stolen ?? []);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('pirate demand roll', () => {
  const rng = (seed: number) => createRng(`demand-${seed}`);
  it('follows the configured weights and only offers what applies', () => {
    const cargoOnly = {
      ...rules,
      encounter: {
        ...rules.encounter,
        pirate_motive_weights: { cargo: 1, parts: 0, territory: 0 },
      },
    };
    for (let seed = 0; seed < 50; seed += 1) {
      expect(
        rollPirateDemand({ objectCarried: true, storage: STORAGE }, cargoOnly, rng(seed)).motive,
      ).toBe('cargo');
      // no cargo aboard and no weight left for anything else: territory is the fallback
      expect(
        rollPirateDemand({ objectCarried: false, storage: STORAGE }, cargoOnly, rng(seed)).motive,
      ).toBe('territory');
    }
  });

  it('takes one or two distinct parts', () => {
    const partsOnly = {
      ...rules,
      encounter: {
        ...rules.encounter,
        pirate_motive_weights: { cargo: 0, parts: 1, territory: 0 },
      },
    };
    const counts = new Set<number>();
    for (let seed = 0; seed < 100; seed += 1) {
      const demand = rollPirateDemand(
        { objectCarried: false, storage: STORAGE },
        partsOnly,
        rng(seed),
      );
      expect(demand.motive).toBe('parts');
      expect(new Set(demand.stolen).size).toBe(demand.stolen.length);
      counts.add(demand.stolen.length);
    }
    expect([...counts].sort()).toEqual([1, 2]);
  });
});

describe('pirate strength by zone', () => {
  it('safer zones meet weaker pirates, and a cap below every option still leaves one', () => {
    const sheet = { mob: 2, pdf: 10, bli: 5, esc: 0, sen: 2, hp: 100 };
    const strongest = (zone: number) => {
      let best = 0;
      for (let seed = 0; seed < 300; seed += 1) {
        const pirate = generatePirate(
          sheet,
          rules,
          createRng(`z-${seed}`),
          rules.encounter.pirate_zone_strength[String(zone)],
        );
        best = Math.max(best, pirate.hp);
      }
      return best;
    };
    expect(strongest(0)).toBeLessThan(strongest(3));
    expect(strongest(1)).toBeLessThanOrEqual(strongest(2));
    expect(generatePirate(sheet, rules, createRng('x'), 0.01).hp).toBeGreaterThan(0);
  });
});
