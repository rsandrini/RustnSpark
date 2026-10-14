import { describe, expect, it } from 'vitest';
import { classOfGroup, matchesPartGroup, partGroupOf } from './part-group';

describe('part groups', () => {
  it('splits Defense into hull, armor and shield by family, in every size and rarity', () => {
    expect(partGroupOf('hull', 'DEFENSE')).toBe('HULL');
    expect(partGroupOf('hull_large_epic', 'DEFENSE')).toBe('HULL');
    expect(partGroupOf('armor_plate_small', 'DEFENSE')).toBe('ARMOR');
    expect(partGroupOf('shield_medium_rare', 'DEFENSE')).toBe('SHIELD');
  });

  it('splits engines and weapons by kind', () => {
    expect(partGroupOf('engine_ion_micro', 'ENGINE')).toBe('ENGINE_ION');
    expect(partGroupOf('engine_chem_large', 'ENGINE')).toBe('ENGINE_CHEM');
    expect(partGroupOf('weapon_laser_heavy', 'WEAPON')).toBe('WEAPON_LASER');
    expect(partGroupOf('weapon_missile_battery', 'WEAPON')).toBe('WEAPON_MISSILE');
  });

  it('leaves other classes, and unknown families, as their class', () => {
    expect(partGroupOf('tank_small', 'TANK')).toBe('TANK');
    expect(partGroupOf('mystery', 'DEFENSE')).toBe('DEFENSE');
  });

  it('matches either a group or a whole class', () => {
    expect(matchesPartGroup('hull', 'DEFENSE', 'HULL')).toBe(true);
    expect(matchesPartGroup('hull', 'DEFENSE', 'ARMOR')).toBe(false);
    expect(matchesPartGroup('hull', 'DEFENSE', 'DEFENSE')).toBe(true);
    expect(matchesPartGroup('hull', 'DEFENSE', null)).toBe(true);
  });

  it('keeps groups under their class for ordering', () => {
    expect(classOfGroup('SHIELD')).toBe('DEFENSE');
    expect(classOfGroup('TANK')).toBe('TANK');
  });
});
