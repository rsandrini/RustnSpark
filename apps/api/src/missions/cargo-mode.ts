import type { GameRules } from '../config/game-config.types.js';

/**
 * How a delivery treats the ship's cargo space (the template's `cargoMode`):
 * - `min`: the ship's cargo space must reach `cargo`; nothing is loaded (the default);
 * - `fixed`: exactly `cargo` units are loaded and take that much of the cargo space, fixed pay;
 * - `open`: at least `cargo` units are needed, the ship loads all the space it has left, and every unit
 *   beyond the minimum pays `unitPay`.
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
  /** Whether the cargo space has room for what the mission asks. */
  readonly fits: boolean;
}

/** What the mission loads, given the ship's cargo space and the ore already in it. */
export function cargoLoadFor(terms: CargoTerms, capacity: number, ore: number): CargoLoad {
  const room = Math.max(0, capacity - ore);
  switch (terms.mode) {
    case 'min':
      return { units: 0, fits: capacity >= terms.need };
    case 'fixed':
      return { units: terms.need, fits: room >= terms.need };
    case 'open':
      return { units: Math.max(terms.need, room), fits: room >= terms.need };
  }
}

/** The extra pay of an open load: each unit beyond the minimum. */
export function openCargoExtra(terms: CargoTerms, unitsCarried: number): number {
  return terms.mode === 'open' ? Math.max(0, unitsCarried - terms.need) * terms.unitPay : 0;
}
