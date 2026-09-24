import type { GameRules } from '../config/game-config.types.js';
import { roundHalfEven } from '../resolution/numeric/round-half-even.js';
import { locationFactor } from './repair-cost.calculator.js';

export interface FuelCostInput {
  /** Ship sheet `fuelUse` (fuel per 100 distance). */
  readonly fuelUse: number;
  readonly distance: number;
  readonly envFuelMult: number;
  readonly isolation: number;
  readonly factionRelation: string;
}

/**
 * Raw fuel units burned for a transit (sim `fuel_gasto`): the distance term
 * only, with Python half-even rounding (D16d). This is what leaves the tank.
 */
export function fuelUnits(
  input: Pick<FuelCostInput, 'fuelUse' | 'distance' | 'envFuelMult'>,
): number {
  return roundHalfEven((input.fuelUse * input.distance * input.envFuelMult) / 100);
}

/**
 * Fuel cost (plan S5.8 / sim): `round(fuelUse × distance / 100 × env.fuel_mult)
 * × fuel_price × location factor`. The distance term uses Python half-even
 * rounding (D16d). Mission travel burns `fuelUnits` from the tank and does
 * not charge credits — fuel is prepaid inventory bought via S8.3 refuel,
 * so charging here would double-spend the same units.
 */
export function fuelCost(input: FuelCostInput, rules: GameRules): number {
  const units = fuelUnits(input);
  return (
    units * rules.economy.fuel_price * locationFactor(input.isolation, input.factionRelation, rules)
  );
}

/**
 * S8.3 refuel: raw tank units × `fuel_price` × location factor
 * (isolation × faction, GDD §9 `fator_local`; mood applies to part prices
 * only per plan S5.8). Returns an unrounded float — callers round to whole
 * credits (wallet amounts must be integers).
 */
export function refuelCost(
  units: number,
  isolation: number,
  factionRelation: string,
  rules: GameRules,
): number {
  return units * rules.economy.fuel_price * locationFactor(isolation, factionRelation, rules);
}
