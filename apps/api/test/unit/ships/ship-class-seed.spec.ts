import { describe, expect, it } from '@jest/globals';
import { PARTS } from '../../../prisma/seed-data/parts.js';
import { STARTER_PARTS } from '../../../prisma/seed-data/starter-kit.js';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { InstalledPart, PartCatalog } from '../../../src/parts/part.types.js';
import { deriveSheet } from '../../../src/ships/sheet.deriver.js';
import { deriveShipIdentity } from '../../../src/ships/ship-class.js';
import { deriveShipProfile } from '../../../src/ships/ship-profile.js';

// Ship rows derived from the real seed catalog through the real sheet -> profile -> identity chain, so a
// change to the catalog or the references that flips an early ship's type is caught here.
const rules = GAME_CONFIG_DEFAULTS;
const BY_TYPE = new Map(PARTS.map((part) => [part.partType, part]));

function catalogOf(partType: string): PartCatalog {
  const row = BY_TYPE.get(partType);
  if (row === undefined) throw new Error(`seed part ${partType} not found`);
  return {
    partType: row.partType,
    partClass: row.partClass,
    w: row.w,
    h: row.h,
    mass: row.mass,
    structureCost: row.structureCost,
    partHp: row.partHp,
    basePrice: row.basePrice,
    pot: row.pot ?? 0,
    pdf: row.pdf ?? 0,
    bli: row.bli ?? 0,
    esc: row.esc ?? 0,
    sen: row.sen ?? 0,
    crg: row.crg ?? 0,
    min: row.min ?? 0,
    energyCont: row.energyCont ?? 0,
    energyCombat: row.energyCombat ?? 0,
    fuelCap: row.fuelCap ?? 0,
    fuelUse: row.fuelUse ?? 0,
    batCharge: row.batCharge ?? 0,
    batOutput: row.batOutput ?? 0,
    batInput: row.batInput ?? 0,
    pressurized: row.specialProp?.pressurized ?? false,
    lifeSupport: row.specialProp?.lifeSupport ?? false,
    pax: row.specialProp?.pax ?? 0,
    lifeCap: row.specialProp?.lifeCap ?? 0,
  };
}

function identityOf(partTypes: readonly string[]): { type: string; modifier: string | null } {
  const parts = partTypes.map(
    (partType, index) =>
      ({
        instance: { id: `p${index}`, condition: 100 },
        catalog: catalogOf(partType),
      }) as unknown as InstalledPart,
  );
  const profile = deriveShipProfile(deriveSheet(parts, rules), rules);
  const identity = deriveShipIdentity(profile, rules);
  return { type: identity.shipClass, modifier: identity.modifier };
}

const rep = (partType: string, count: number): string[] => Array<string>(count).fill(partType);
const BASE = ['bridge', 'engine_chem_small', 'reactor_solar', 'tank_small'];
const STARTER_MEDIUM = STARTER_PARTS.map((p) =>
  p === 'engine_chem_small' ? 'engine_chem_medium' : p,
);

describe('ship types of real seed builds', () => {
  const rows: [string, readonly string[], string, string | null][] = [
    ['starter kit', STARTER_PARTS, 'BALANCED', null],
    [
      'starter with a medium engine and a gun',
      [...STARTER_MEDIUM, 'weapon_ballistic'],
      'BALANCED',
      null,
    ],
    ['starter with one cargo bay', [...STARTER_PARTS, 'cargo_bay'], 'HAULER', null],
    ['14 Common cargo bays', [...BASE, ...rep('cargo_bay', 14)], 'HAULER', null],
    ['8 Common cannons', [...BASE, ...rep('weapon_ballistic', 8)], 'WARSHIP', null],
    [
      'light fast Common chem ship',
      ['bridge', 'engine_chem_medium', 'engine_chem_medium', 'reactor_solar', 'tank_small'],
      'RACER',
      null,
    ],
    [
      'Rare ion racer',
      ['bridge_rare', ...rep('engine_ion_medium_rare', 3), 'reactor_nuclear_rare'],
      'RACER',
      null,
    ],
    [
      '8 Uncommon cargo bays',
      [
        'bridge_uncommon',
        'engine_chem_small_uncommon',
        'reactor_solar_uncommon',
        'tank_small_uncommon',
        ...rep('cargo_bay_uncommon', 8),
      ],
      'HAULER',
      null,
    ],
    [
      'Rare 4 cargo bays and 3 large armor',
      [
        'bridge_rare',
        'engine_chem_small_rare',
        'reactor_solar_rare',
        'tank_small_rare',
        ...rep('cargo_bay_rare', 4),
        ...rep('armor_plate_large_rare', 3),
      ],
      'BALANCED',
      null,
    ],
    [
      'Rare 6 cargo bays and 2 large shields',
      [
        'bridge_rare',
        'engine_chem_small_rare',
        'reactor_solar_rare',
        'tank_small_rare',
        ...rep('cargo_bay_rare', 6),
        ...rep('shield_large_rare', 2),
      ],
      'HAULER',
      'defense',
    ],
  ];

  it.each(rows)('%s', (_name, partTypes, type, modifier) => {
    expect(identityOf(partTypes)).toEqual({ type, modifier });
  });
});
