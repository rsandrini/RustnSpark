import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import {
  applyEngineLevels,
  clampLevels,
  cleanRunChance,
  engineGroupOf,
  fuelFactor,
  mishapChance,
} from '../../../src/resolution/engine/engine.js';
import type { InstalledPart, PartCatalog } from '../../../src/parts/part.types.js';

const rules = GAME_CONFIG_DEFAULTS;

function part(id: string, catalog: Partial<PartCatalog>): InstalledPart {
  return {
    instance: { id, partType: id, condition: 100 },
    catalog: {
      partType: id,
      partClass: 'ENGINE',
      w: 1,
      h: 1,
      mass: 5,
      structureCost: 2,
      partHp: 20,
      basePrice: 100,
      pot: 0,
      pdf: 0,
      bli: 0,
      esc: 0,
      sen: 0,
      crg: 0,
      min: 0,
      energyCont: 0,
      energyCombat: 0,
      fuelCap: 0,
      fuelUse: 0,
      batCharge: 0,
      batOutput: 0,
      batInput: 0,
      ...catalog,
    } as PartCatalog,
  };
}

const chem = part('chem', { pot: 40, fuelUse: 10, energyCont: 4 });
const ion = part('ion', { pot: 36, energyCont: -6 });
const cargo = part('cargo', { partClass: 'CARGO', crg: 5 });

describe('engine tuning', () => {
  it('tells the groups apart: fuel burners are chemical, the rest of the engines are ion', () => {
    expect(engineGroupOf(chem.catalog)).toBe('chem');
    expect(engineGroupOf(ion.catalog)).toBe('ion');
    expect(engineGroupOf(cargo.catalog)).toBeNull();
  });

  it('level 1 changes nothing; other parts are never touched', () => {
    const out = applyEngineLevels([chem, ion, cargo], { chem: 1, ion: 1 }, rules);
    expect(out[0]!.catalog).toEqual(chem.catalog);
    expect(out[1]!.catalog).toEqual(ion.catalog);
    expect(out[2]).toBe(cargo);
  });

  it('chemical: thrust and power follow the level; fuel is proportional below 1, steeper above', () => {
    const down = applyEngineLevels([chem], { chem: 0.5, ion: 1 }, rules)[0]!.catalog;
    expect(down.pot).toBe(20);
    expect(down.fuelUse).toBeCloseTo(5);
    expect(down.energyCont).toBe(2);
    const up = applyEngineLevels([chem], { chem: 1.5, ion: 1 }, rules)[0]!.catalog;
    expect(up.pot).toBe(60);
    expect(up.fuelUse).toBeCloseTo(10 * fuelFactor(1.5, rules));
    expect(up.fuelUse).toBeGreaterThan(10 * 1.5);
  });

  it('ion: thrust follows the level, the power draw climbs faster than the thrust', () => {
    const pushed = applyEngineLevels([ion], { chem: 1, ion: 2 }, rules)[0]!.catalog;
    expect(pushed.pot).toBe(72);
    expect(pushed.energyCont).toBe(-6 * 2 ** rules.engine.ion_power_exponent);
    expect(pushed.fuelUse).toBe(0);
    const eased = applyEngineLevels([ion], { chem: 1, ion: 0.5 }, rules)[0]!.catalog;
    expect(eased.energyCont).toBeCloseTo(-1.5);
  });

  it('a level outside the admin range is brought back inside it', () => {
    expect(clampLevels({ chem: 9, ion: 0 }, rules)).toEqual({
      chem: rules.engine.chem_level_max,
      ion: rules.engine.ion_level_min,
    });
  });

  it('no failure chance at level 1 or below; the chance at the top level is the configured one', () => {
    expect(mishapChance('chem', 1, 100, rules)).toBe(0);
    expect(mishapChance('ion', 0.7, 100, rules)).toBe(0);
    expect(mishapChance('chem', rules.engine.chem_level_max, 100, rules)).toBeCloseTo(
      rules.engine.mishap_at_max,
    );
  });

  it('pushing harder, or with worn engines, fails more often', () => {
    const mild = mishapChance('ion', 1.5, 100, rules);
    const hard = mishapChance('ion', 2.2, 100, rules);
    const worn = mishapChance('ion', 2.2, 20, rules);
    expect(mild).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(mild);
    expect(worn).toBeGreaterThan(hard);
  });

  it('the clean-run chance multiplies the legs and the pushed groups, and is 1 when nothing is pushed', () => {
    const engines = [
      { engineGroup: 'chem' as const, condition: 100 },
      { engineGroup: 'ion' as const, condition: 100 },
    ];
    expect(cleanRunChance(engines, { chem: 1, ion: 1 }, 5, rules)).toBe(1);
    const oneLeg = cleanRunChance(engines, { chem: 1.5, ion: 1 }, 1, rules);
    const threeLegs = cleanRunChance(engines, { chem: 1.5, ion: 1 }, 3, rules);
    expect(oneLeg).toBeCloseTo(1 - rules.engine.mishap_at_max);
    expect(threeLegs).toBeCloseTo(oneLeg ** 3);
    // a group the ship does not have cannot fail
    expect(
      cleanRunChance([{ engineGroup: 'chem' as const, condition: 100 }], { chem: 1, ion: 2.5 }, 3, rules),
    ).toBe(1);
  });
});
