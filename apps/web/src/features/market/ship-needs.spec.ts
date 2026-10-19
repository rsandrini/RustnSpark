import { describe, expect, it } from 'vitest';
import type { ShipSheet } from '../../api/generated';
import { isShield, lackingParts } from './ship-needs';

const sheet = { pdf: 5, bli: 3, esc: 0, energyCont: 1, crg: 4 } as unknown as ShipSheet;
const part = (partClass: string, partType: string) => ({
  id: partType,
  displayName: { en: partType, 'pt-BR': partType },
  catalog: { partClass, partType, w: 1, h: 1 },
});
const ids = (installed: ReturnType<typeof part>[]) =>
  lackingParts(sheet, installed).map((need) => need.id);

describe('lackingParts: the recommended shield and battery', () => {
  it('asks for both when the ship has neither', () => {
    expect(ids([part('ENGINE', 'engine_chem_small')])).toEqual(['shield', 'battery']);
  });

  it('a shield is a DEFENSE part told apart by its family name: armor does not count as one', () => {
    expect(isShield({ partClass: 'DEFENSE', partType: 'shield_basic' })).toBe(true);
    expect(isShield({ partClass: 'DEFENSE', partType: 'shield_large_rare' })).toBe(true);
    expect(isShield({ partClass: 'DEFENSE', partType: 'armor_plate' })).toBe(false);
    expect(ids([part('DEFENSE', 'armor_plate')])).toContain('shield');
  });

  it('an installed shield and an installed battery clear the tip, whatever their rarity', () => {
    expect(ids([part('DEFENSE', 'shield_basic'), part('BATTERY', 'battery_small')])).toEqual([]);
    expect(
      ids([part('DEFENSE', 'shield_medium_epic'), part('BATTERY', 'battery_bank_rare')]),
    ).toEqual([]);
  });

  it('asks only for what is missing', () => {
    expect(ids([part('DEFENSE', 'shield_basic')])).toEqual(['battery']);
    expect(ids([part('BATTERY', 'battery_small')])).toEqual(['shield']);
  });
});
