import { describe, it, expect } from 'vitest';
import en from '../../i18n/en.json';
import ptBR from '../../i18n/pt-BR.json';
import { PART_KIND_ORDER, kindLabelKey, partKindOf, type PartKind } from './part-kind';

const FAMILIES: Record<string, PartKind> = {
  bridge: 'bridge',
  bridge_2x2: 'bridge',
  engine_chem_large: 'engine',
  engine_chem_medium: 'engine',
  engine_chem_small: 'engine',
  engine_ion_medium: 'engine',
  engine_ion_micro: 'engine',
  engine_ion_small: 'engine',
  tank_huge: 'tank',
  tank_large: 'tank',
  tank_medium: 'tank',
  tank_small: 'tank',
  battery_bank: 'battery',
  battery_large: 'battery',
  battery_small: 'battery',
  reactor_nuclear: 'reactor',
  reactor_nuclear_large: 'reactor',
  reactor_nuclear_small: 'reactor',
  reactor_solar: 'reactor',
  reactor_solar_large: 'reactor',
  weapon_ballistic: 'weapon',
  weapon_ballistic_heavy: 'weapon',
  weapon_laser: 'weapon',
  weapon_laser_heavy: 'weapon',
  weapon_missile: 'weapon',
  weapon_missile_battery: 'weapon',
  weapon_missile_light: 'weapon',
  armor_plate: 'armor',
  armor_plate_large: 'armor',
  armor_plate_small: 'armor',
  hull: 'hull',
  hull_large: 'hull',
  hull_small: 'hull',
  shield_basic: 'shield',
  shield_large: 'shield',
  shield_medium: 'shield',
  cargo: 'cargo',
  cargo_bay: 'cargo',
  cargo_large: 'cargo',
  passenger_cabin: 'cabin',
  sensor_radar: 'sensor',
  sensor_radar_large: 'sensor',
  life_support: 'life',
  mining_rig: 'mining',
  mining_rig_heavy: 'mining',
};

describe('partKindOf', () => {
  for (const [partType, kind] of Object.entries(FAMILIES)) {
    it(`${partType} -> ${kind} (also with a rarity suffix)`, () => {
      expect(partKindOf({ partClass: 'UTILITY', partType })).toBe(kind);
      expect(partKindOf({ partClass: 'UTILITY', partType: `${partType}_epic` })).toBe(kind);
    });
  }

  it('falls back to the class when the type is unknown', () => {
    expect(partKindOf({ partClass: 'DEFENSE', partType: 'mystery' })).toBe('armor');
    expect(partKindOf({ partClass: 'ENGINE', partType: 'mystery' })).toBe('engine');
    expect(partKindOf({ partClass: 'UTILITY', partType: 'mystery' })).toBe('other');
  });

  it('is other when nothing is known', () => {
    expect(partKindOf({ partClass: 'WHATEVER' as never, partType: 'mystery' })).toBe('other');
  });

  it('flags win over the class', () => {
    expect(partKindOf({ partClass: 'CARGO', partType: 'x', pressurized: true })).toBe('cabin');
    expect(partKindOf({ partClass: 'UTILITY', partType: 'x', lifeSupport: true })).toBe('life');
  });

  it('every kind is ordered once and has a label in both locales', () => {
    expect(new Set(PART_KIND_ORDER).size).toBe(PART_KIND_ORDER.length);
    expect(PART_KIND_ORDER).toContain('other');
    for (const kind of PART_KIND_ORDER) {
      const key = kindLabelKey(kind);
      expect(key).toBe(`hangar.partKinds.${kind}`);
      const leaf = key.split('.');
      for (const locale of [en, ptBR]) {
        const value = leaf.reduce<unknown>(
          (acc, k) => (acc as Record<string, unknown>)?.[k],
          locale,
        );
        expect(typeof value).toBe('string');
      }
    }
  });
});
