import type { GameRules } from '../config/game-config.types.js';

/**
 * How a delivery treats the ship's cargo space (the template's `cargoMode`):
 * - `min`: the ship's cargo space must reach the `min_ratio` share of `cargo` (the rest is flown in extra
 *   trips); nothing is loaded (the default);
 * - `fixed`: `cargo` units are loaded, capped at the hold (a smaller hold flies them in trips), fixed pay;
 * - `open`: the `min_ratio` share of `cargo` is the minimum, the ship loads all the space it has, and every
 *   unit beyond `cargo` pays `unitPay`.
 */
export type CargoMode = 'min' | 'fixed' | 'open';

export interface CargoTerms {
  readonly mode: CargoMode;
  readonly need: number;
  /** Credits per unit beyond `need` (open cargo only). */
  readonly unitPay: number;
}

/** The cargo terms of a delivery's template requirements; null for the types that do not load cargo. */
export function cargoTermsOf(
  missionType: string,
  requirements: unknown,
  rules: GameRules,
): CargoTerms | null {
  if (missionType !== 'DELIVERY') return null;
  const record =
    typeof requirements === 'object' && requirements !== null
      ? (requirements as Record<string, unknown>)
      : {};
  const mode: CargoMode =
    record['cargoMode'] === 'fixed' || record['cargoMode'] === 'open' ? record['cargoMode'] : 'min';
  const need = typeof record['cargo'] === 'number' && record['cargo'] > 0 ? record['cargo'] : 1;
  const unitPay =
    typeof record['unitPay'] === 'number' && record['unitPay'] >= 0
      ? record['unitPay']
      : rules.missions.open_cargo_unit_pay;
  return { mode, need, unitPay };
}

export interface CargoLoad {
  /** Units put aboard (0 for `min`). */
  readonly units: number;
}

/**
 * What the mission loads, given the ship's cargo space (the pilot's goods take none). Whether the hold is
 * enough (the `min_ratio` share) is checked elsewhere; a hold below the load flies it in trips, each carrying
 * what the hold takes, so `units` never exceeds the cargo space.
 */
export function cargoLoadFor(terms: CargoTerms, capacity: number): CargoLoad {
  const room = capacity;
  switch (terms.mode) {
    case 'min':
      return { units: 0 };
    case 'fixed':
      return { units: Math.min(terms.need, room) };
    case 'open':
      return { units: room };
  }
}

/** The extra pay of an open load: each unit beyond the minimum. */
export function openCargoExtra(terms: CargoTerms, unitsCarried: number): number {
  return terms.mode === 'open' ? Math.max(0, unitsCarried - terms.need) * terms.unitPay : 0;
}
