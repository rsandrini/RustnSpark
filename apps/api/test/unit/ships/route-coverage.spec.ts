import { describe, expect, it } from '@jest/globals';
import { routeCoverage } from '../../../src/ships/route-coverage.js';

const routes = [
  { distance: 400, envFuelMult: 1 },
  { distance: 800, envFuelMult: 1 },
  { distance: 800, envFuelMult: 2 },
  { distance: 1200, envFuelMult: 1 },
];

describe('routeCoverage', () => {
  it('is null for a ship that burns no fuel (unlimited)', () => {
    expect(routeCoverage({ fuelCap: 0, fuelUse: 0 }, routes)).toBeNull();
  });

  it('counts the routes a full tank can cross, using each route\'s own fuel multiplier', () => {
    // fuelUse 10 per 100 distance, tank 80 -> 800 distance at multiplier 1
    expect(routeCoverage({ fuelCap: 80, fuelUse: 10 }, routes)).toEqual({ covered: 2, total: 4 });
    // tank 120: the 1200 route (needs 120) fits, the 800-at-x2 route (needs 160) does not
    expect(routeCoverage({ fuelCap: 120, fuelUse: 10 }, routes)).toEqual({ covered: 3, total: 4 });
    expect(routeCoverage({ fuelCap: 160, fuelUse: 10 }, routes)).toEqual({ covered: 4, total: 4 });
  });

  it('covers nothing with an empty tank and counts zero routes in an empty world', () => {
    expect(routeCoverage({ fuelCap: 0, fuelUse: 10 }, routes)).toEqual({ covered: 0, total: 4 });
    expect(routeCoverage({ fuelCap: 50, fuelUse: 10 }, [])).toEqual({ covered: 0, total: 0 });
  });
});
