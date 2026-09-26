import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
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

// Balance safety net (W1): what danger does to a starter ship, by zone. The numbers are printed
// (run with --verbose) and recorded in the round-2 plan; the assertions only pin the shape that
// must hold whatever the tuning: safer zones are met less often and lost less often.
const STORAGE = [
  { id: 'spare-1', partType: 'cargo' },
  { id: 'spare-2', partType: 'hull' },
];
const DANGER_BY_ZONE: Record<number, number> = { 0: 2, 1: 5, 2: 8, 3: 8 };
const RUNS = 1500;

// The seeded starter ship really has no weapon and no shield (firepower 0): the second column of the
// table shows what a new pilot faces, the first what a well-armed ship faces.
const STARTER_SHEET = { pdf: 0, bli: 1, esc: 0, sen: 0, hp: 145, mob: 2 };
const ARMED_SHEET = { pdf: 8, bli: 3, esc: 14, sen: 4, hp: 145, mob: 2 };

function zoneStats(zone: number, flee: boolean, armed: boolean) {
  const sheetOver = armed ? ARMED_SHEET : STARTER_SHEET;
  let fights = 0;
  let wins = 0;
  let losses = 0;
  let escapes = 0;
  let failed = 0;
  let hull = 0;
  let credits = 0;
  for (let seed = 0; seed < RUNS; seed += 1) {
    const outcome = resolveMission({
      seed: `bal-${zone}-${flee}-${armed}-${seed}`,
      snapshot: snapshot({
        storage: STORAGE,
        sheet: { ...snapshot().sheet, ...sheetOver },
        hp: sheetOver.hp,
        esc: sheetOver.esc,
      }),
      mission: mission({
        missionForcesFlee: flee,
        legs: [
          {
            distance: 500,
            danger: DANGER_BY_ZONE[zone]!,
            zone,
            env: { id: 'open', level: 1, fuelMult: 1 },
          },
          {
            distance: 500,
            danger: DANGER_BY_ZONE[zone]!,
            zone,
            env: { id: 'open', level: 1, fuelMult: 1 },
          },
        ],
      }),
      rules,
    });
    const has = (type: string) => outcome.events.some((event) => event.type === type);
    if (has('combat_win') || has('combat_loss')) fights += 1;
    if (has('combat_win')) wins += 1;
    if (has('combat_loss')) losses += 1;
    if (has('escaped')) escapes += 1;
    if (outcome.status === 'failed') failed += 1;
    hull += outcome.events
      .filter((event) => event.type === 'combat_win' || event.type === 'combat_loss')
      .reduce((sum, event) => sum + Math.abs(event.effects.hp), 0);
    credits += outcome.creditsDelta;
  }
  const pct = (value: number) => Math.round((value / RUNS) * 1000) / 10;
  return {
    ship: armed ? 'armed' : 'starter',
    zone,
    flee,
    fightRate: pct(fights),
    winRate: pct(wins),
    lossRate: pct(losses),
    escapeRate: pct(escapes),
    failRate: pct(failed),
    hullPerRun: Math.round(hull / RUNS),
    creditsPerRun: Math.round(credits / RUNS),
  };
}

describe('danger by zone (balance)', () => {
  const table = [true, false].flatMap((armed) =>
    [0, 1, 2, 3].flatMap((zone) => [zoneStats(zone, false, armed), zoneStats(zone, true, armed)]),
  );
  it('prints the table the plan records', () => {
    console.info(JSON.stringify(table));
    expect(table.length).toBe(16);
  });
  it('safer zones are fought over less and lost less', () => {
    const plain = table.filter((row) => !row.flee && row.ship === 'armed');
    expect(plain[0]!.fightRate).toBeLessThan(plain[3]!.fightRate);
    expect(plain[0]!.lossRate).toBeLessThanOrEqual(plain[3]!.lossRate);
    // Danger is real: a dangerous zone costs the starter ship a lot more than a safe one.
    expect(plain[3]!.failRate).toBeGreaterThan(plain[0]!.failRate);
  });
  it('fleeing changes the mix: a delivery that flees fights less', () => {
    for (const zone of [1, 2, 3]) {
      const stay = table.find((row) => row.ship === 'armed' && row.zone === zone && !row.flee)!;
      const flee = table.find((row) => row.ship === 'armed' && row.zone === zone && row.flee)!;
      expect(flee.fightRate).toBeLessThan(stay.fightRate);
    }
  });
});
