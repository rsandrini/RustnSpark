import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import { EMPTY_SHEET } from './fixtures/empty-sheet.js';
import { deriveShipProfile } from '../../../src/ships/ship-profile.js';

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
