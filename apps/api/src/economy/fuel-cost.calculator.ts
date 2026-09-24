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
 * Fuel cost (plan S5.8 / sim): `round(fuelUse × distance / 100 × env.fuel_mult)
 * × fuel_price × location factor`. The distance term uses Python half-even
 * rounding (D16d).
 */
export function fuelCost(input: FuelCostInput, rules: GameRules): number {
  const units = roundHalfEven((input.fuelUse * input.distance * input.envFuelMult) / 100);
  return (
    units * rules.economy.fuel_price * locationFactor(input.isolation, input.factionRelation, rules)
  );
}
