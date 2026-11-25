import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import { deriveShipClass, deriveShipIdentity } from '../../../src/ships/ship-class.js';
import type { ShipProfile } from '../../../src/ships/ship-profile.js';

const rules = GAME_CONFIG_DEFAULTS;

const ZERO: ShipProfile = {
  cargo: 0,
  passengers: 0,
  firepower: 0,
  defense: 0,
  mobility: 0,
  range: 0,
  mining: 0,
};
const profile = (parts: Partial<ShipProfile>): ShipProfile => ({ ...ZERO, ...parts });
const withProfileRules = (patch: Partial<GameRules['ship_profile']>): GameRules => ({
  ...rules,
  ship_profile: { ...rules.ship_profile, ...patch },
});

describe('deriveShipClass (the type follows the relative shape)', () => {
  it('names a pure cargo ship HAULER, however small its absolute value', () => {
    expect(deriveShipClass(profile({ cargo: 0.7 }), rules)).toBe('HAULER');
    expect(deriveShipClass(profile({ cargo: 0.08 }), rules)).toBe('HAULER');
  });

  it('names a passenger ship TRANSPORT', () => {
    expect(deriveShipClass(profile({ passengers: 0.6 }), rules)).toBe('TRANSPORT');
  });

  it('names a gun-heavy hull with a big shield WARSHIP (the better of firepower and defense)', () => {
    expect(deriveShipClass(profile({ firepower: 0.3, defense: 0.7 }), rules)).toBe('WARSHIP');
    expect(deriveShipClass(profile({ firepower: 0.7, defense: 0.2 }), rules)).toBe('WARSHIP');
  });

  it('keeps a cargo ship a HAULER when it carries one tiny mining part', () => {
    expect(deriveShipClass(profile({ cargo: 0.65, mining: 0.02 }), rules)).toBe('HAULER');
  });

  it('names a dedicated mining ship MINER and a fast light hull RACER', () => {
    expect(deriveShipClass(profile({ mining: 0.5 }), rules)).toBe('MINER');
    expect(deriveShipClass(profile({ mobility: 0.6, cargo: 0.05 }), rules)).toBe('RACER');
  });

  it('gives range no type of its own: a long-range ship takes the next axis', () => {
    expect(deriveShipClass(profile({ range: 0.9, cargo: 0.4 }), rules)).toBe('HAULER');
    expect(deriveShipClass(profile({ range: 0.9 }), rules)).toBe('BALANCED');
  });

  it('is BALANCED when two axes are about equal (lead under the margin)', () => {
    expect(deriveShipClass(profile({ cargo: 0.6, mining: 0.6 }), rules)).toBe('BALANCED');
    expect(deriveShipClass(profile({ cargo: 0.6, mining: 0.5 }), rules)).toBe('BALANCED');
    expect(deriveShipClass(profile({ mobility: 0.5, passengers: 0.5 }), rules)).toBe('BALANCED');
  });

  it('is BALANCED when no axis holds half of the whole (three even axes)', () => {
    expect(deriveShipClass(profile({ cargo: 0.4, mining: 0.3, mobility: 0.3 }), rules)).toBe(
      'BALANCED',
    );
  });

  it('is BALANCED when the ship is nearly empty', () => {
    expect(deriveShipClass(ZERO, rules)).toBe('BALANCED');
    expect(deriveShipClass(profile({ cargo: 0.03, mobility: 0.01 }), rules)).toBe('BALANCED');
  });

  it('names the type when the lead sits exactly on the margin (float noise tolerated)', () => {
    // shares 0.575 and 0.425 would not do; use a total of 1: top 0.575, second 0.425 -> lead 0.15
    expect(deriveShipClass(profile({ cargo: 0.575, mining: 0.425 }), rules)).toBe('HAULER');
    // 0.35 - 0.25 is 0.0999999... in floats
    const margin = withProfileRules({ lead_margin: 0.1, min_share: 0.4 });
    expect(deriveShipClass(profile({ cargo: 0.35, mining: 0.25 }), margin)).toBe('HAULER');
  });

  it('applies a changed knob at once', () => {
    const p = profile({ cargo: 0.3, mining: 0.1 });
    expect(deriveShipClass(p, rules)).toBe('HAULER');
    expect(deriveShipClass(p, withProfileRules({ min_share: 0.9 }))).toBe('BALANCED');
    expect(deriveShipClass(p, withProfileRules({ lead_margin: 0.6 }))).toBe('BALANCED');
    expect(deriveShipClass(p, withProfileRules({ min_total: 0.5 }))).toBe('BALANCED');
  });
});

// The early game, from the seed catalog (see docs/balance/ship-profile-references.md): a ship with a small
// absolute profile still has a type.
describe('early ships have a type', () => {
  const cases: [string, Partial<ShipProfile>, string][] = [
    ['starter kit', { cargo: 0.018, mobility: 0.026, range: 0.041 }, 'BALANCED'],
    ['14 Common cargo bays', { cargo: 0.636, mobility: 0.006, range: 0.041 }, 'HAULER'],
    ['8 Common cannons', { firepower: 0.114, mobility: 0.019, range: 0.041 }, 'WARSHIP'],
    ['light fast Common chem ship', { mobility: 0.134, range: 0.01 }, 'RACER'],
    ['Rare ion racer', { mobility: 0.456 }, 'RACER'],
    ['8 Uncommon cargo bays', { cargo: 0.436, mobility: 0.013, range: 0.045 }, 'HAULER'],
    [
      'Rare 4 bays and 3 large armor',
      { cargo: 0.291, defense: 0.325, mobility: 0.017 },
      'BALANCED',
    ],
  ];
  it.each(cases)('%s', (_name, axes, expected) => {
    expect(deriveShipClass(profile(axes), rules)).toBe(expected);
  });
});

describe('deriveShipIdentity modifier', () => {
  it('returns a strong second axis (absolute) as the modifier', () => {
    expect(deriveShipIdentity(profile({ cargo: 0.9, firepower: 0.55 }), rules)).toEqual({
      shipClass: 'HAULER',
      modifier: 'firepower',
    });
  });

  it('cargo-heavy with a strong shield is a HAULER with a defense modifier', () => {
    expect(deriveShipIdentity(profile({ cargo: 0.436, defense: 0.221 }), rules)).toEqual({
      shipClass: 'HAULER',
      modifier: 'defense',
    });
  });

  it('has no modifier when the second axis is small in absolute terms and in share', () => {
    expect(deriveShipIdentity(profile({ cargo: 0.8, firepower: 0.1 }), rules).modifier).toBeNull();
  });

  it('lets range be a modifier although it never names a type', () => {
    expect(deriveShipIdentity(profile({ cargo: 0.8, range: 0.6 }), rules)).toEqual({
      shipClass: 'HAULER',
      modifier: 'range',
    });
    // but a small range never qualifies by share
    expect(deriveShipIdentity(profile({ cargo: 0.1, range: 0.4 }), rules).modifier).toBeNull();
  });

  it('does not repeat the axis that named a warship as its modifier', () => {
    expect(
      deriveShipIdentity(profile({ firepower: 0.9, defense: 0.1 }), rules).modifier,
    ).toBeNull();
    expect(deriveShipIdentity(profile({ defense: 0.9, firepower: 0.6 }), rules)).toEqual({
      shipClass: 'WARSHIP',
      modifier: 'firepower',
    });
  });

  it('a BALANCED ship has no modifier', () => {
    expect(deriveShipIdentity(profile({ cargo: 0.6, mining: 0.6 }), rules)).toEqual({
      shipClass: 'BALANCED',
      modifier: null,
    });
  });

  it('applies second_min and second_share at once', () => {
    const p = profile({ cargo: 0.8, firepower: 0.35 });
    expect(deriveShipIdentity(p, rules).modifier).toBe('firepower'); // share 0.35/1.15 = 0.30
    expect(deriveShipIdentity(p, withProfileRules({ second_share: 0.5 })).modifier).toBeNull();
    expect(
      deriveShipIdentity(p, withProfileRules({ second_share: 0.5, second_min: 0.3 })).modifier,
    ).toBe('firepower');
  });
});
