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

describe('deriveShipClass', () => {
  it('names a pure cargo ship HAULER', () => {
    expect(deriveShipClass(profile({ cargo: 0.7 }), rules)).toBe('HAULER');
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

  it('names a dedicated mining ship MINER', () => {
    expect(deriveShipClass(profile({ mining: 0.5 }), rules)).toBe('MINER');
  });

  it('names a fast light hull RACER', () => {
    expect(deriveShipClass(profile({ mobility: 0.6, cargo: 0.1 }), rules)).toBe('RACER');
  });

  it('gives range no type of its own: a long-range ship takes the next axis', () => {
    expect(deriveShipClass(profile({ range: 0.9, cargo: 0.4 }), rules)).toBe('HAULER');
    expect(deriveShipClass(profile({ range: 0.9 }), rules)).toBe('BALANCED');
  });

  it('is BALANCED when two axes are about equal (lead under the margin)', () => {
    expect(deriveShipClass(profile({ cargo: 0.6, mining: 0.6 }), rules)).toBe('BALANCED');
    expect(deriveShipClass(profile({ cargo: 0.6, mining: 0.55 }), rules)).toBe('BALANCED');
  });

  it('is BALANCED when no axis reaches the minimum (a weak ship)', () => {
    expect(deriveShipClass(profile({ cargo: 0.2, mining: 0.05 }), rules)).toBe('BALANCED');
    expect(deriveShipClass(ZERO, rules)).toBe('BALANCED');
  });

  it('breaks an exact tie nowhere: equal leaders are BALANCED, so the order only matters for a lead', () => {
    expect(deriveShipClass(profile({ mobility: 0.5, passengers: 0.5 }), rules)).toBe('BALANCED');
  });

  it('applies a changed knob at once', () => {
    const p = profile({ cargo: 0.3, mining: 0.15 });
    expect(deriveShipClass(p, rules)).toBe('HAULER');
    const stricter: GameRules = {
      ...rules,
      ship_profile: { ...rules.ship_profile, min_main: 0.5 },
    };
    expect(deriveShipClass(p, stricter)).toBe('BALANCED');
    const wider: GameRules = {
      ...rules,
      ship_profile: { ...rules.ship_profile, lead_margin: 0.2 },
    };
    expect(deriveShipClass(p, wider)).toBe('BALANCED');
  });
});

describe('deriveShipIdentity', () => {
  it('returns the strong second axis as the modifier', () => {
    expect(deriveShipIdentity(profile({ cargo: 0.8, firepower: 0.55 }), rules)).toEqual({
      shipClass: 'HAULER',
      modifier: 'firepower',
    });
  });

  it('has no modifier when the second axis is below second_min', () => {
    expect(deriveShipIdentity(profile({ cargo: 0.8, firepower: 0.45 }), rules).modifier).toBeNull();
  });

  it('lets range be a modifier although it never names a type', () => {
    expect(deriveShipIdentity(profile({ cargo: 0.8, range: 0.6 }), rules)).toEqual({
      shipClass: 'HAULER',
      modifier: 'range',
    });
  });

  it('does not repeat the axis that named a warship as its modifier', () => {
    expect(
      deriveShipIdentity(profile({ firepower: 0.9, defense: 0.2 }), rules).modifier,
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

  it('applies second_min at once', () => {
    const lower: GameRules = {
      ...rules,
      ship_profile: { ...rules.ship_profile, second_min: 0.3 },
    };
    expect(deriveShipIdentity(profile({ cargo: 0.8, firepower: 0.35 }), lower).modifier).toBe(
      'firepower',
    );
  });
});
