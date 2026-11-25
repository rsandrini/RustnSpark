import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import { EMPTY_SHEET } from './fixtures/empty-sheet.js';
import {
  deriveShipProfile,
  deriveShipProfileDetail,
  PROFILE_AXES,
} from '../../../src/ships/ship-profile.js';

const rules = GAME_CONFIG_DEFAULTS;
const ref = rules.ship_profile;

describe('deriveShipProfile', () => {
  it('a pure-cargo sheet fills the cargo axis and nothing else', () => {
    const profile = deriveShipProfile(
      { ...EMPTY_SHEET, crg: ref.ref_cargo * 0.9, mass: 20 },
      rules,
    );
    expect(profile.cargo).toBeCloseTo(0.9);
    expect(profile.passengers).toBe(0);
    expect(profile.firepower).toBe(0);
    expect(profile.defense).toBe(0);
    expect(profile.mobility).toBe(0);
    expect(profile.range).toBe(0);
    expect(profile.mining).toBe(0);
  });

  it('clamps every axis to 1 for a huge value', () => {
    const huge = 1e9;
    const profile = deriveShipProfile(
      {
        ...EMPTY_SHEET,
        crg: huge,
        pax: huge,
        lifeCap: huge,
        pdf: huge,
        bli: huge,
        esc: huge,
        pot: huge,
        mass: 1,
        autonomy: huge,
        min: huge,
      },
      rules,
    );
    expect(Object.values(profile)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it('a fuel-free ship (fuelUse 0) has a full range axis, a fuel-burning one reads its autonomy', () => {
    expect(
      deriveShipProfile({ ...EMPTY_SHEET, fuelUse: 0, autonomy: 0, pot: 5, mass: 5 }, rules).range,
    ).toBe(1);
    expect(deriveShipProfile({ ...EMPTY_SHEET, fuelUse: 0, autonomy: 0 }, rules).range).toBe(0);
    const burning = { ...EMPTY_SHEET, fuelUse: 2, autonomy: ref.ref_range / 2 };
    expect(deriveShipProfile(burning, rules).range).toBeCloseTo(0.5);
  });

  it('an empty sheet gives zeros, never NaN (zero mass included)', () => {
    const profile = deriveShipProfile(EMPTY_SHEET, rules);
    expect(Object.values(profile)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('survives a zero reference and non-finite stats without NaN', () => {
    const broken: GameRules = {
      ...rules,
      ship_profile: { ...ref, ref_cargo: 0, ref_range: 0 },
    };
    const profile = deriveShipProfile(
      { ...EMPTY_SHEET, crg: 5, autonomy: Number.NaN, pot: Number.POSITIVE_INFINITY, mass: 1 },
      broken,
    );
    for (const value of Object.values(profile)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('passengers are the seats the life support can keep alive', () => {
    const half = ref.ref_passengers / 2;
    expect(
      deriveShipProfile({ ...EMPTY_SHEET, pax: ref.ref_passengers, lifeCap: half }, rules)
        .passengers,
    ).toBeCloseTo(0.5);
    expect(
      deriveShipProfile({ ...EMPTY_SHEET, pax: half, lifeCap: ref.ref_passengers }, rules)
        .passengers,
    ).toBeCloseTo(0.5);
    // Seats without any air do not count.
    expect(
      deriveShipProfile({ ...EMPTY_SHEET, pax: ref.ref_passengers, lifeCap: 0 }, rules).passengers,
    ).toBe(0);
  });

  it('defense is the shield plus the armor times the armor pool factor', () => {
    const factor = rules.combat.armor_pool_factor;
    const shield = 100;
    const armor = 20;
    const profile = deriveShipProfile({ ...EMPTY_SHEET, esc: shield, bli: armor }, rules);
    expect(profile.defense).toBeCloseTo((shield + armor * factor) / ref.ref_defense);
    const doubled: GameRules = {
      ...rules,
      combat: { ...rules.combat, armor_pool_factor: factor * 2 },
    };
    expect(deriveShipProfile({ ...EMPTY_SHEET, bli: armor }, doubled).defense).toBeCloseTo(
      (armor * factor * 2) / ref.ref_defense,
    );
  });

  it('firepower reads the weapons, mobility reads thrust over mass, range the autonomy', () => {
    const profile = deriveShipProfile(
      {
        ...EMPTY_SHEET,
        pdf: ref.ref_firepower / 2,
        pot: 50,
        mass: 100,
        fuelUse: 1,
        autonomy: ref.ref_range / 4,
        min: ref.ref_mining / 5,
      },
      rules,
    );
    expect(profile.firepower).toBeCloseTo(0.5);
    expect(profile.mobility).toBeCloseTo(((50 / 100) * rules.ship.mob_factor) / ref.ref_mobility);
    expect(profile.range).toBeCloseTo(0.25);
    expect(profile.mining).toBeCloseTo(0.2);
  });
});

describe('deriveShipProfileDetail (the numbers behind the axes)', () => {
  const starter = {
    ...EMPTY_SHEET,
    pot: 12,
    mass: 60,
    crg: 40,
    pdf: 15,
    esc: 30,
    bli: 20,
    fuelUse: 2,
    autonomy: 20000,
    pax: 2,
    lifeCap: 4,
  };
  const hauler = {
    ...EMPTY_SHEET,
    pot: 20,
    mass: 200,
    crg: 400,
    pax: 10,
    lifeCap: 4,
    fuelUse: 5,
    autonomy: 50000,
    esc: 10,
  };
  const ionRacer = { ...EMPTY_SHEET, pot: 40, mass: 20, fuelUse: 0, autonomy: 0, pdf: 5 };
  const refs = {
    cargo: ref.ref_cargo,
    passengers: ref.ref_passengers,
    firepower: ref.ref_firepower,
    defense: ref.ref_defense,
    mobility: ref.ref_mobility,
    range: ref.ref_range,
    mining: ref.ref_mining,
  };

  it.each([
    ['starter', starter],
    ['cargo hauler', hauler],
    ['fuel-free ion racer', ionRacer],
  ])('%s: every axis is min(1, value / ref) and the refs are the config refs', (_n, sheet) => {
    const profile = deriveShipProfile(sheet, rules);
    const detail = deriveShipProfileDetail(sheet, rules);
    for (const key of PROFILE_AXES) {
      expect(detail[key].ref).toBe(refs[key]);
      expect(profile[key]).toBeCloseTo(Math.min(1, detail[key].value / detail[key].ref), 10);
    }
  });

  it('reports the raw values: cargo, bounded passengers, armor-weighted defense', () => {
    const detail = deriveShipProfileDetail(hauler, rules);
    expect(detail.cargo.value).toBe(400);
    expect(detail.passengers.value).toBe(4);
    expect(detail.defense.value).toBeCloseTo(10);
    expect(deriveShipProfileDetail(starter, rules).defense.value).toBeCloseTo(
      30 + 20 * rules.combat.armor_pool_factor,
    );
  });

  it('a fuel-free ion ship reports range value = ref (unlimited reads as a full axis)', () => {
    const detail = deriveShipProfileDetail(ionRacer, rules);
    expect(detail.range).toEqual({ value: ref.ref_range, ref: ref.ref_range });
    expect(deriveShipProfile(ionRacer, rules).range).toBe(1);
  });
});
