/** The fighters of the fight lab: from the starter ship to a maximum-power fighter, all from real catalog parts. */
import {
  buildFighter,
  type Dials,
  type Fighter,
  fixedPirate,
  generatedPirate,
  type Pirate,
} from './lib.js';

const LAYOUTS: Array<{ name: string; note: string; parts: string[] }> = [
  {
    name: 'F1 starter',
    note: 'the starter kit: one gun, no shield',
    parts: [
      'bridge',
      'hull',
      'engine_chem_small',
      'tank_small',
      'cargo',
      'reactor_solar',
      'weapon_ballistic',
    ],
  },
  {
    name: 'F2 starter+armor',
    note: 'F1 with a small armor plate',
    parts: [
      'bridge',
      'hull',
      'engine_chem_small',
      'tank_small',
      'cargo',
      'reactor_solar',
      'weapon_ballistic',
      'armor_plate_small',
    ],
  },
  {
    name: 'F3 owner day 2',
    note: 'the pilot on day 2: first shield, ion engines',
    parts: [
      'reactor_solar',
      'weapon_ballistic',
      'cargo',
      'engine_ion_medium',
      'hull_small_rare',
      'shield_medium_uncommon',
      'engine_ion_micro_uncommon',
      'reactor_nuclear_small',
      'reactor_solar_uncommon',
      'bridge_uncommon',
    ],
  },
  {
    name: 'F4 owner now',
    note: 'the pilot at the end of the prod run: one gun, one rare shield',
    parts: [
      'battery_small_rare',
      'reactor_solar_rare',
      'mining_rig_rare',
      'weapon_ballistic_rare',
      'cargo_rare',
      'cargo_rare',
      'engine_ion_medium_rare',
      'hull_small_rare',
      'shield_medium_rare',
      'engine_ion_micro_rare',
      'reactor_nuclear_small_uncommon',
      'reactor_solar_rare',
      'bridge_uncommon',
    ],
  },
  {
    name: 'F5 gunboat',
    note: 'simple and no shield: two heavy guns and plates',
    parts: [
      'weapon_ballistic_heavy_rare',
      'weapon_ballistic_heavy_rare',
      'armor_plate_rare',
      'armor_plate_rare',
      'hull_rare',
      'engine_ion_medium_rare',
      'reactor_nuclear_small_rare',
      'bridge_rare',
    ],
  },
  {
    name: 'F6 shield gunboat',
    note: 'F5 plus an epic shield and a battery',
    parts: [
      'weapon_ballistic_heavy_rare',
      'weapon_ballistic_heavy_rare',
      'armor_plate_rare',
      'armor_plate_rare',
      'hull_rare',
      'engine_ion_medium_rare',
      'reactor_nuclear_rare',
      'bridge_rare',
      'shield_medium_epic',
      'battery_small_epic',
    ],
  },
  {
    name: 'F7 laser frigate',
    note: 'heavy lasers (armor-piercing), large rare shield',
    parts: [
      'weapon_laser_heavy_epic',
      'weapon_laser_heavy_epic',
      'shield_large_rare',
      'armor_plate_large_epic',
      'hull_large_rare',
      'engine_ion_medium_epic',
      'reactor_nuclear_epic',
      'battery_bank_rare',
      'bridge_epic',
      'sensor_radar_epic',
    ],
  },
  {
    name: 'F8 missile cruiser',
    note: 'missile batteries, a large epic shield and double armor',
    parts: [
      'weapon_missile_battery_epic',
      'weapon_missile_battery_epic',
      'weapon_laser_heavy_epic',
      'shield_large_epic',
      'armor_plate_large_epic',
      'armor_plate_large_epic',
      'hull_large_epic',
      'hull_large_epic',
      'engine_ion_medium_epic',
      'engine_ion_medium_epic',
      'reactor_nuclear_large_rare',
      'battery_bank_epic',
      'bridge_2x2_rare',
      'sensor_radar_large_epic',
    ],
  },
  {
    name: 'F9 maximum fighter',
    note: 'the best of everything, all legendary',
    parts: [
      'weapon_missile_battery_legendary',
      'weapon_missile_battery_legendary',
      'weapon_missile_battery_legendary',
      'weapon_laser_heavy_legendary',
      'weapon_laser_heavy_legendary',
      'shield_large_legendary',
      'shield_large_legendary',
      'armor_plate_large_legendary',
      'armor_plate_large_legendary',
      'armor_plate_large_legendary',
      'hull_large_legendary',
      'hull_large_legendary',
      'engine_ion_medium_legendary',
      'engine_ion_medium_legendary',
      'reactor_nuclear_large_legendary',
      'battery_bank_legendary',
      'battery_bank_legendary',
      'sensor_radar_large_legendary',
      'bridge_2x2_legendary',
    ],
  },
];

export function ladder(dials?: Dials): Fighter[] {
  return LAYOUTS.map((layout) => buildFighter(layout.name, layout.note, layout.parts, dials));
}

/** Fixed pirates by region, weakest to strongest (stats: hull, firepower, armor, shield, mobility, sensors). */
export function fixedLadder(): Pirate[] {
  return [
    fixedPirate('P0 raider (zone 0-1)', 50, 2, 0, 0, 2),
    fixedPirate('P1 pirate (zone 1)', 90, 3, 1, 0, 3),
    fixedPirate('P2 marauder (zone 2)', 220, 5, 1, 20, 5, 1),
    fixedPirate('P3 warband (zone 3)', 400, 6, 2, 20, 6, 1),
    fixedPirate('P4 reaver (far)', 600, 8, 0, 20, 8, 1),
    fixedPirate('P5 raider lord (far hard)', 600, 12, 2, 20, 10, 2),
    fixedPirate('P6 corsair (elite)', 900, 18, 4, 60, 10, 3),
    fixedPirate('P7 warlord (elite+)', 1400, 30, 8, 120, 12, 5),
    fixedPirate('P8 dread (boss)', 2200, 50, 14, 220, 14, 8),
  ];
}

export function todayPirates(): Pirate[] {
  return [generatedPirate(1), generatedPirate(3)];
}
