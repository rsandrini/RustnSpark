import { fuelUnits } from '../economy/fuel-cost.calculator.js';

export interface RouteCoverage {
  /** Routes a full tank gets the ship across (one way). */
  covered: number;
  /** Routes in the world. */
  total: number;
}

/**
 * How many routes a full tank covers — the readable form of the sheet's range. Ships that burn
 * no fuel (ion) can go anywhere, so there is nothing to count: null ("unlimited"). A route's cost
 * uses its harshest environment's fuel multiplier, so "covers" never over-promises.
 */
export function routeCoverage(
  sheet: { fuelCap: number; fuelUse: number },
  routes: readonly { distance: number; envFuelMult: number }[],
): RouteCoverage | null {
  if (sheet.fuelUse <= 0) return null;
  const covered = routes.filter(
    (route) =>
      fuelUnits({
        fuelUse: sheet.fuelUse,
        distance: route.distance,
        envFuelMult: route.envFuelMult,
      }) <= sheet.fuelCap,
  ).length;
  return { covered, total: routes.length };
}
