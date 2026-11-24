import { describe, it, expect } from 'vitest';
import { fixHref, fixOf } from './requirement-fix';

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

  it('names life support when only it is missing', () => {
    expect(fixOf('PRESSURIZED_LIFE_SUPPORT', 'Needs Life Support installed')).toEqual({
      kind: 'store',
      partClass: 'UTILITY',
    });
  });

  it.each(['NO_BRIDGE', 'NO_ENGINE', 'OVERLAP'])('%s leads to the ship', (code) => {
    expect(fixOf(code)).toEqual({ kind: 'ship' });
  });

  it('a short fuel leads to refuel', () => {
    expect(fixOf('fuel-short')).toEqual({ kind: 'refuel' });
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
