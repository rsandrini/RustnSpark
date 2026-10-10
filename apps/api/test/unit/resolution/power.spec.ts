import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import {
  allocatePower,
  powerPartOf,
  successChance,
  type PowerPart,
} from '../../../src/resolution/power/power.js';

const rules = GAME_CONFIG_DEFAULTS;
const p = (id: string, kind: PowerPart['kind'], demand: number, over: Partial<PowerPart> = {}): PowerPart => ({
  id,
  kind,
  demand,
  idle: 1,
  supply: 0,
  ...over,
});
const generator = (id: string, supply: number, engine = false): PowerPart => ({
  id,
  kind: 'other',
  demand: 0,
  idle: 0,
  supply,
  ...(engine ? { engine: true } : {}),
});

describe('successChance', () => {
  it('follows the curve: 100 → 100, 95 → 90, 80 → 70, 70 → 60 and nothing below', () => {
    expect(successChance(1, rules)).toBe(1);
    expect(successChance(1.4, rules)).toBe(1);
    expect(successChance(0.95, rules)).toBeCloseTo(0.9);
    expect(successChance(0.8, rules)).toBeCloseTo(0.7);
    expect(successChance(0.7, rules)).toBeCloseTo(0.6);
    expect(successChance(0.49, rules)).toBe(0);
  });
  it('interpolates between the points', () => {
    expect(successChance(0.875, rules)).toBeCloseTo(0.8);
  });
});

describe('allocatePower', () => {
  it('with enough power every system gets everything', () => {
    const state = allocatePower(
      [generator('g', 20), p('bridge', 'bridge', 2), p('sensor', 'sensor', 4), p('gun', 'weapon', 3)],
      'cruise',
      rules,
    );
    expect(state.byKind.sensor).toBe(1);
    expect(state.byKind.weapon).toBe(1);
  });

  it('the bridge is served first, then life support, whatever is short', () => {
    const state = allocatePower(
      [generator('g', 4), p('bridge', 'bridge', 2), p('life', 'life', 3), p('sensor', 'sensor', 4)],
      'cruise',
      rules,
    );
    expect(state.byKind.bridge).toBe(1);
    // 2 left for life support's 3
    expect(state.byKind.life).toBeCloseTo(2 / 3);
    expect(state.byKind.sensor).toBe(0);
  });

  it('while travelling a weapon only draws its idle minimum; in a fight it draws more and is primary', () => {
    const parts = [
      generator('g', 6),
      p('bridge', 'bridge', 1),
      p('pump', 'pump', 1),
      p('sensor', 'sensor', 4),
      p('gun', 'weapon', 2, { idle: 2 }),
    ];
    const cruise = allocatePower(parts, 'cruise', rules);
    // bridge 1, pump 1, sensor 4 = 6; the idle gun (2) gets what is left: nothing
    expect(cruise.byKind.sensor).toBe(1);
    expect(cruise.byKind.weapon).toBe(0);
    const combat = allocatePower(parts, 'combat', rules);
    // bridge 1, pump 1, then the gun now draws 2 x 2 = 4 of the 4 left; sensors are secondary
    expect(combat.byKind.weapon).toBe(1);
    expect(combat.byKind.sensor).toBe(0);
  });

  it('systems of one tier share equally', () => {
    const state = allocatePower(
      [generator('g', 3), p('a', 'sensor', 4), p('b', 'sensor', 4)],
      'cruise',
      rules,
    );
    expect(state.shares.get('a')).toBeCloseTo(3 / 8);
    expect(state.shares.get('b')).toBeCloseTo(3 / 8);
  });

  it('struggling engines generate less, which starves the rest further', () => {
    const parts = [generator('e', 4, true), p('sensor', 'sensor', 4)];
    expect(allocatePower(parts, 'cruise', rules).byKind.sensor).toBe(1);
    expect(allocatePower(parts, 'cruise', rules, 0.5).byKind.sensor).toBeCloseTo(0.5);
  });
});

describe('powerPartOf', () => {
  const base = { partClass: 'UTILITY', energyCont: -6, esc: 0, min: 1, pressurized: false, lifeSupport: false };
  it('reads the role from the part', () => {
    expect(powerPartOf('r', base, 1).kind).toBe('rig');
    expect(powerPartOf('t', { ...base, partClass: 'TANK', min: 0 }, 1).kind).toBe('pump');
    expect(powerPartOf('s', { ...base, partClass: 'DEFENSE', esc: 14, min: 0 }, 1).kind).toBe('shield');
    expect(powerPartOf('c', { ...base, partClass: 'CARGO', pressurized: true, min: 0 }, 1).kind).toBe('life');
    expect(powerPartOf('e', { ...base, partClass: 'ENGINE', energyCont: 3, min: 0 }, 1)).toMatchObject({
      supply: 3,
      demand: 0,
      engine: true,
    });
  });
  it('a laser can idle on 2, other systems on the default', () => {
    expect(powerPartOf('l', { ...base, partClass: 'WEAPON', min: 0, idlePower: 2 }, 1).idle).toBe(2);
    expect(powerPartOf('b', { ...base, partClass: 'WEAPON', min: 0 }, 1).idle).toBe(1);
  });
});
