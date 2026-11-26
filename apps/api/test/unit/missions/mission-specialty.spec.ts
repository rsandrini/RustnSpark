import { describe, expect, it } from '@jest/globals';
import { MissionType } from '@prisma/client';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import {
  peakDangerOf,
  SPECIALTY_TABLE,
  specialtyOf,
  specialtyStat,
  specialtyStretch,
} from '../../../src/missions/mission-specialty.js';
import type { ShipSheet } from '../../../src/ships/sheet.types.js';

const DEFAULT_RULES: GameRules = GAME_CONFIG_DEFAULTS;

function sheetWith(
  over: Partial<{
    pdf: number;
    esc: number;
    bli: number;
    pax: number;
    lifeCap: number;
    crg: number;
  }>,
): ShipSheet {
  return {
    pot: 10,
    pdf: 0,
    bli: 0,
    esc: 0,
    sen: 0,
    crg: 0,
    min: 0,
    hp: 100,
    mass: 100,
    energyCont: 0,
    energyCombat: 0,
    batCharge: 0,
    batOutput: 0,
    batInput: 0,
    fuelCap: 100,
    fuelUse: 1,
    pax: 0,
    lifeCap: 0,
    structureUsed: 0,
    structureBudget: 0,
    autonomy: 1000,
    mob: 1,
    condition: 1,
    ...over,
  };
}

const group = (passengers: number): { requirements: unknown; peakDanger: number } => ({
  requirements: { passengers },
  peakDanger: 0,
});
const load = (cargo: number): { requirements: unknown; peakDanger: number } => ({
  requirements: { cargo },
  peakDanger: 0,
});
const danger = (peakDanger: number): { requirements: unknown; peakDanger: number } => ({
  requirements: {},
  peakDanger,
});

describe('mission specialty', () => {
  it('transport: group 3 in 3 seats is one trip', () => {
    const v = specialtyOf('TRANSPORT', group(3), sheetWith({ pax: 3, lifeCap: 3 }), DEFAULT_RULES);
    expect(v).toMatchObject({ factor: 1, trips: 1, met: true });
  });

  it('transport: group 5 in 3 seats is two trips', () => {
    const v = specialtyOf('TRANSPORT', group(5), sheetWith({ pax: 3, lifeCap: 3 }), DEFAULT_RULES);
    expect(v).toMatchObject({ factor: 3, trips: 2, minimum: 3, met: true });
  });

  it('transport: group 6 in 2 seats is refused', () => {
    const v = specialtyOf('TRANSPORT', group(6), sheetWith({ pax: 2, lifeCap: 2 }), DEFAULT_RULES);
    expect(v).toMatchObject({ met: false, minimum: 3, blocker: 'PASSENGER_SEATS' });
  });

  it('transport: seats without air count as the life support', () => {
    const sheet = sheetWith({ pax: 6, lifeCap: 2 });
    const v = specialtyOf('TRANSPORT', group(4), sheet, DEFAULT_RULES);
    expect(v?.have).toBe(2);
    expect(v?.trips).toBe(2);
  });

  it('delivery: a hold equal to the load is one trip', () => {
    const v = specialtyOf('DELIVERY', load(40), sheetWith({ crg: 40 }), DEFAULT_RULES);
    expect(v).toMatchObject({ stat: 'cargo', factor: 1, trips: 1, met: true });
  });

  it('delivery: a load of 2.5 holds is three trips', () => {
    const v = specialtyOf('DELIVERY', load(100), sheetWith({ crg: 40 }), DEFAULT_RULES);
    expect(v).toMatchObject({ factor: 5, trips: 3, met: true });
  });

  it('delivery: a hold under a quarter of the load is refused with the cargo blocker', () => {
    const v = specialtyOf('DELIVERY', load(100), sheetWith({ crg: 20 }), DEFAULT_RULES);
    expect(v).toMatchObject({ met: false, minimum: 25, blocker: 'CARGO_TYPE' });
    expect(specialtyStretch('DELIVERY', load(100), sheetWith({ crg: 20 }), DEFAULT_RULES)).toBe(1);
  });

  it('delivery: no hold is refused with a finite factor', () => {
    const v = specialtyOf('DELIVERY', load(10), sheetWith({ crg: 0 }), DEFAULT_RULES);
    expect(v?.met).toBe(false);
    expect(Number.isFinite(v?.factor)).toBe(true);
  });

  it('escort: need grows with danger', () => {
    const sheet = sheetWith({});
    const lo = specialtyOf('ESCORT', danger(0), sheet, DEFAULT_RULES);
    const hi = specialtyOf('ESCORT', danger(10), sheet, DEFAULT_RULES);
    expect((hi?.need ?? 0) - (lo?.need ?? 0)).toBeCloseTo(0.2, 10);
  });

  it('escort: weaker than the need is slower, by the exponent', () => {
    const rules: GameRules = {
      ...DEFAULT_RULES,
      specialty: {
        ...DEFAULT_RULES.specialty,
        escort: { ...DEFAULT_RULES.specialty.escort, min_ratio: 0.1 },
      },
    };
    const need = specialtyOf('ESCORT', danger(10), sheetWith({}), rules)?.need ?? 0;
    // combat = (pdf / ref_firepower) / 2 with no defense: pick pdf so that have = need / 4
    const pdf = (need / 4) * 2 * rules.ship_profile.ref_firepower;
    const v = specialtyOf('ESCORT', danger(10), sheetWith({ pdf }), rules);
    expect(v?.have).toBeCloseTo(need / 4, 10);
    expect(v?.met).toBe(true);
    expect(v?.factor).toBeCloseTo(2, 10);
  });

  it('escort: huge ship is clamped at fastest', () => {
    const sheet = sheetWith({ pdf: 1e6, esc: 1e6, bli: 1e6 });
    const v = specialtyOf('ESCORT', danger(10), sheet, DEFAULT_RULES);
    expect(v?.factor).toBe(0.85);
  });

  it('zero stat is refused, factor finite', () => {
    const escort = specialtyOf('ESCORT', danger(5), sheetWith({}), DEFAULT_RULES);
    expect(escort?.met).toBe(false);
    expect(Number.isFinite(escort?.factor)).toBe(true);
    const transport = specialtyOf('TRANSPORT', group(2), sheetWith({ pax: 0 }), DEFAULT_RULES);
    expect(transport?.met).toBe(false);
    expect(Number.isFinite(transport?.factor)).toBe(true);
  });

  it('built-in and trip-less types have no verdict', () => {
    for (const type of ['RACE', 'RESCUE', 'MINING', 'TRAVEL', 'SCAVENGE'] as const) {
      const sheet = sheetWith({});
      expect(specialtyOf(type, danger(0), sheet, DEFAULT_RULES)).toBeNull();
      expect(specialtyStretch(type, danger(0), sheet, DEFAULT_RULES)).toBe(1);
    }
  });

  it('transport: float error does not raise the minimum', () => {
    const rules = (ratio: number): GameRules => ({
      ...DEFAULT_RULES,
      specialty: { ...DEFAULT_RULES.specialty, transport: { min_ratio: ratio } },
    });
    const sheet = sheetWith({ pax: 3, lifeCap: 3 });
    expect(specialtyOf('TRANSPORT', group(30), sheet, rules(0.1))).toMatchObject({
      minimum: 3,
      met: true,
    });
    expect(specialtyOf('TRANSPORT', group(10), sheet, rules(0.3))?.minimum).toBe(3);
    expect(
      specialtyOf('TRANSPORT', group(10), sheetWith({ pax: 7, lifeCap: 7 }), rules(0.7)),
    ).toMatchObject({ minimum: 7, met: true });
  });

  it('transport: a refused group still has a finite trips value', () => {
    const v = specialtyOf('TRANSPORT', group(6), sheetWith({ pax: 2, lifeCap: 2 }), DEFAULT_RULES);
    expect(v).toMatchObject({ met: false, trips: 2, factor: 3 });
  });

  it('delivery: the cargo mode does not change the verdict', () => {
    const sheet = sheetWith({ crg: 40 });
    const base = specialtyOf('DELIVERY', load(100), sheet, DEFAULT_RULES);
    for (const cargoMode of ['open', 'fixed', 'min']) {
      const offer = { requirements: { cargo: 100, cargoMode }, peakDanger: 0 };
      expect(specialtyOf('DELIVERY', offer, sheet, DEFAULT_RULES)).toEqual(base);
    }
  });

  it('the fastest clamp shows in specialtyStretch', () => {
    const sheet = sheetWith({ pdf: 1e6, esc: 1e6, bli: 1e6 });
    expect(specialtyStretch('ESCORT', danger(10), sheet, DEFAULT_RULES)).toBe(0.85);
  });

  it('need 0 is met and finite', () => {
    const v = specialtyOf(
      'DELIVERY',
      { requirements: { cargo: 0 }, peakDanger: 0 },
      sheetWith({}),
      DEFAULT_RULES,
    );
    expect(v?.need).toBe(1);
    const e = specialtyOf('ESCORT', danger(0), sheetWith({}), {
      ...DEFAULT_RULES,
      specialty: {
        ...DEFAULT_RULES.specialty,
        escort: { ...DEFAULT_RULES.specialty.escort, reference: 0, per_danger: 0 },
      },
    });
    expect(e).toMatchObject({ need: 0, met: true });
    expect(Number.isFinite(e?.factor)).toBe(true);
  });

  it('no NaN leaves the verdict', () => {
    const v = specialtyOf('ESCORT', danger(Number.NaN), sheetWith({}), DEFAULT_RULES);
    for (const n of [v?.need, v?.have, v?.minimum, v?.factor]) {
      expect(Number.isFinite(n)).toBe(true);
    }
    const t = specialtyOf(
      'TRANSPORT',
      { requirements: { passengers: Number.NaN }, peakDanger: 0 },
      sheetWith({ pax: Number.NaN }),
      DEFAULT_RULES,
    );
    for (const n of [t?.need, t?.have, t?.minimum, t?.factor, t?.trips]) {
      expect(Number.isFinite(n)).toBe(true);
    }
  });

  it('every stat reads the ship', () => {
    const sheet = sheetWith({ pax: 4, lifeCap: 9, crg: 7 });
    expect(specialtyStat('passengers', sheet, DEFAULT_RULES)).toBe(4);
    expect(specialtyStat('cargo', sheet, DEFAULT_RULES)).toBe(7);
  });

  it('every MissionType has a table entry', () => {
    expect(Object.keys(SPECIALTY_TABLE).sort()).toEqual(Object.values(MissionType).sort());
  });

  it('peakDangerOf is the highest leg danger, 0 without legs or danger', () => {
    expect(peakDangerOf([{ danger: 2 }, { danger: 7 }, {}])).toBe(7);
    expect(peakDangerOf([])).toBe(0);
    expect(peakDangerOf(null)).toBe(0);
  });
});
