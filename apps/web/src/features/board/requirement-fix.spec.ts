import { describe, it, expect } from 'vitest';
import { fixHref, fixOf, fuelFix } from './requirement-fix';

describe('fixOf', () => {
  it.each([
    ['CARGO_TYPE', 'CARGO'],
    ['PRESSURIZED_LIFE_SUPPORT', 'CARGO'],
    ['WEAPONS', 'WEAPON'],
    ['MIN_MOBILITY', 'ENGINE'],
    ['SPEED', 'ENGINE'],
    ['RACE_SPEED', 'ENGINE'],
    ['MINER', 'UTILITY'],
    ['FUEL_CAPACITY', 'TANK'],
  ])('%s leads to the %s store tab', (code, partClass) => {
    expect(fixOf(code)).toEqual({ kind: 'store', partClass });
  });

  it.each(['NO_BRIDGE', 'NO_ENGINE', 'PART_DISCONNECTED', 'STRUCTURE_EXCEEDED'])(
    '%s leads to the ship',
    (code) => {
      expect(fixOf(code)).toEqual({ kind: 'ship' });
    },
  );

  it.each(['NO_LIFE_SUPPORT', 'LIFE_SUPPORT_UNPOWERED'])(
    '%s leads to the UTILITY store tab',
    (code) => {
      expect(fixOf(code)).toEqual({ kind: 'store', partClass: 'UTILITY' });
    },
  );

  it('does not invent a fuel code', () => {
    expect(fixOf('fuel-short')).toEqual({ kind: 'none' });
  });

  it('an unknown code leads nowhere', () => {
    expect(fixOf('WHATEVER')).toEqual({ kind: 'none' });
    expect(fixHref(fixOf('WHATEVER'))).toBeUndefined();
  });
});

describe('fixHref', () => {
  it('builds each link', () => {
    expect(fixHref({ kind: 'store', partClass: 'CARGO' })).toBe('/ship?store=CARGO');
    expect(fixHref({ kind: 'refuel' })).toBe('/port?tab=refuel');
    expect(fixHref({ kind: 'ship' })).toBe('/ship');
  });
});

describe('fuelFix', () => {
  it('maps each real fuel state', () => {
    expect(fuelFix('short')).toEqual({ kind: 'refuel' });
    expect(fuelFix('tank')).toEqual({ kind: 'store', partClass: 'TANK' });
    expect(fuelFix('ok')).toEqual({ kind: 'none' });
  });
});
