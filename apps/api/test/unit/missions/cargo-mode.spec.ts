import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { cargoLoadFor, cargoTermsOf, openCargoExtra } from '../../../src/missions/cargo-mode.js';

const rules = GAME_CONFIG_DEFAULTS;

const MIN_RATIO = 0.25;

describe('delivery cargo modes', () => {
  it('reads the template: minimum limit by default, fixed or open when set; only deliveries load cargo', () => {
    expect(cargoTermsOf('DELIVERY', { cargo: 4 }, rules)).toEqual({
      mode: 'min',
      need: 4,
      unitPay: rules.missions.open_cargo_unit_pay,
    });
    expect(cargoTermsOf('DELIVERY', { cargo: 6, cargoMode: 'fixed' }, rules)?.mode).toBe('fixed');
    expect(cargoTermsOf('DELIVERY', { cargo: 3, cargoMode: 'open', unitPay: 35 }, rules)).toEqual({
      mode: 'open',
      need: 3,
      unitPay: 35,
    });
    expect(cargoTermsOf('MINING', { cargo: 3, cargoMode: 'open' }, rules)).toBeNull();
  });

  it('minimum limit: nothing is loaded, the cargo space only has to reach the need', () => {
    const terms = cargoTermsOf('DELIVERY', { cargo: 5 }, rules)!;
    expect(cargoLoadFor(terms, 5, MIN_RATIO)).toEqual({ units: 0, fits: true });
    expect(cargoLoadFor(terms, 1, MIN_RATIO)).toEqual({ units: 0, fits: false });
  });

  it('fixed: loads exactly the need and needs that much cargo space', () => {
    const terms = cargoTermsOf('DELIVERY', { cargo: 6, cargoMode: 'fixed' }, rules)!;
    expect(cargoLoadFor(terms, 10, MIN_RATIO)).toEqual({ units: 6, fits: true });
    expect(cargoLoadFor(terms, 1, MIN_RATIO)).toEqual({ units: 1, fits: false });
    expect(openCargoExtra(terms, 6)).toBe(0);
  });

  it('open: loads all the cargo space, needs the minimum, and each unit beyond it pays', () => {
    const terms = cargoTermsOf('DELIVERY', { cargo: 3, cargoMode: 'open', unitPay: 20 }, rules)!;
    expect(cargoLoadFor(terms, 10, MIN_RATIO)).toEqual({ units: 10, fits: true });
    expect(cargoLoadFor(terms, 0.5, MIN_RATIO)).toEqual({ units: 0.5, fits: false });
    expect(openCargoExtra(terms, 8)).toBe(100);
    expect(openCargoExtra(terms, 3)).toBe(0);
  });

  it('a hold below the load but at the minimum still fits: the load is flown in trips, carrying what the hold takes', () => {
    const fixed = cargoTermsOf('DELIVERY', { cargo: 8, cargoMode: 'fixed' }, rules)!;
    expect(cargoLoadFor(fixed, 4, MIN_RATIO)).toEqual({ units: 4, fits: true });
    expect(cargoLoadFor(fixed, 2, MIN_RATIO)).toEqual({ units: 2, fits: true });
    expect(cargoLoadFor(fixed, 1.9, MIN_RATIO)).toEqual({ units: 1.9, fits: false });
    const open = cargoTermsOf('DELIVERY', { cargo: 8, cargoMode: 'open', unitPay: 10 }, rules)!;
    expect(cargoLoadFor(open, 3, MIN_RATIO)).toEqual({ units: 3, fits: true });
    expect(openCargoExtra(open, 3)).toBe(0);
    const min = cargoTermsOf('DELIVERY', { cargo: 8 }, rules)!;
    expect(cargoLoadFor(min, 2, MIN_RATIO)).toEqual({ units: 0, fits: true });
  });
});
