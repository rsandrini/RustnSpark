import { fuelUnits } from './fuel-cost.calculator.js';

const ZERO = 0;
const MIN_UNITS = 1;

export interface StuckInput {
  readonly credits: number;
  /** The hull itself cannot fly (no structure, no power, too heavy to move). */
  readonly hullCannotFly: boolean;
  /** Sheet `fuelUse` (fuel per 100 distance); zero for a ship that burns none. */
  readonly fuelUse: number;
  readonly fuel: number;
  /** The place the ship is at sells fuel (its `services.refuel` is not `false`). */
  readonly sellsFuel: boolean;
  /** Whole credits for the fuel to leave by the cheapest route (`fuelToLeave` priced like a refuel). */
  readonly costToLeave: number;
}

/**
 * Stuck = cannot get out on their own (owner, 2026-11-25): in debt (nothing can be bought or
 * repaired), a hull that cannot fly, or an empty tank the pilot cannot fill (the place sells no fuel,
 * or the wallet cannot pay the fuel for the cheapest route out). An empty tank the pilot can fill is
 * not stuck: refuelling is the way out.
 */
export function isStuck(input: StuckInput): boolean {
  if (input.credits < ZERO || input.hullCannotFly) return true;
  const outOfFuel = input.fuelUse > ZERO && input.fuel <= ZERO;
  if (!outOfFuel) return false;
  return !input.sellsFuel || input.credits < input.costToLeave;
}

/**
 * Tank units for the cheapest route out of a place: each route burns `fuelUnits` with its harshest
 * environment's fuel multiplier (as the ship sheet's route coverage reads it); at least one unit.
 */
export function fuelToLeave(
  fuelUse: number,
  routes: readonly { distance: number; envFuelMult: number }[],
): number {
  const burns = routes.map((route) =>
    fuelUnits({ fuelUse, distance: route.distance, envFuelMult: route.envFuelMult }),
  );
  return Math.max(MIN_UNITS, burns.length === ZERO ? MIN_UNITS : Math.min(...burns));
}
