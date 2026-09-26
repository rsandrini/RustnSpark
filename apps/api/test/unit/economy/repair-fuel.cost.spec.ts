import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import {
  fuelCost,
  fuelUnits,
  refuelCost,
  type FuelCostInput,
} from '../../../src/economy/fuel-cost.calculator.js';
import {
  locationFactor,
  repairCost,
  type RepairPartInput,
} from '../../../src/economy/repair-cost.calculator.js';

const rules: GameRules = GAME_CONFIG_DEFAULTS;

// Parity harness geometry: isolation 1.0, faction neutral → factor 1.0.
const PARITY_ISO = 1;
const PARITY_FACTION = 'neutral';

function part(overrides: Partial<RepairPartInput> = {}): RepairPartInput {
  return { basePrice: 1000, fromCondition: 50, toCondition: 100, ...overrides };
}

function fuel(overrides: Partial<FuelCostInput> = {}): FuelCostInput {
  return {
    fuelUse: 2.5,
    distance: 800,
    envFuelMult: 1,
    isolation: PARITY_ISO,
    factionRelation: PARITY_FACTION,
    ...overrides,
  };
}

describe('S5.8 — location factor (GDD §9 fator_local)', () => {
  it('is isolation × faction', () => {
    expect(locationFactor(1, 'neutral', rules)).toBe(1);
    expect(locationFactor(0.9, 'ally', rules)).toBeCloseTo(0.72, 12);
    expect(locationFactor(2, 'hostile', rules)).toBe(5);
    expect(locationFactor(1.4, 'neutral', rules)).toBeCloseTo(1.4, 12);
  });

  it('pins the approved isolation and faction maps', () => {
    expect(rules.economy.isolation_mult).toEqual({ 0: 0.9, 1: 1.0, 2: 1.4, 3: 2.0 });
    expect(rules.economy.faction_mult).toEqual({ ally: 0.8, neutral: 1.0, hostile: 2.5 });
    expect(rules.economy.repair_factor).toBe(0.8);
    expect(rules.economy.repair_price).toBe(6);
    expect(rules.economy.repair_price_ref).toBe(4);
    expect(rules.economy.maintenance_per_tier).toBe(100);
    expect(rules.economy.fuel_price).toBe(3);
  });
});

describe('S5.8 — repair cost (sim form + location factor)', () => {
  it('matches the plan formula: Σ price × lost% × repair_factor × price/ref + tier × maintenance', () => {
    // One part: 1000 × 0.5 × 0.8 × (6/4) = 600; + tier 1 × 100 = 700; × 1.0
    expect(repairCost([part()], 1, PARITY_ISO, PARITY_FACTION, rules)).toBeCloseTo(700, 10);
  });

  it('sums every part before maintenance and location', () => {
    // 1000×0.5×0.8×1.5 = 600; 400×0.25×0.8×1.5 = 120; sum 720; + tier 3×100 = 1020
    const cost = repairCost(
      [
        part({ basePrice: 1000, fromCondition: 50, toCondition: 100 }),
        part({ basePrice: 400, fromCondition: 75, toCondition: 100 }),
      ],
      3,
      PARITY_ISO,
      PARITY_FACTION,
      rules,
    );
    expect(cost).toBeCloseTo(1020, 10);
  });

  it('applies the location factor to the whole sum (parts + maintenance)', () => {
    // base 700 × isolation 2 × hostile 2.5 = 3500
    expect(repairCost([part()], 1, 2, 'hostile', rules)).toBeCloseTo(3500, 10);
  });

  it('charges nothing for a repair that restores no condition', () => {
    expect(
      repairCost([part({ fromCondition: 100, toCondition: 100 })], 1, 1, 'neutral', rules),
    ).toBeCloseTo(100, 10); // maintenance only
  });

  it('ignores negative condition gain (to < from)', () => {
    expect(
      repairCost([part({ fromCondition: 80, toCondition: 40 })], 1, 1, 'neutral', rules),
    ).toBeCloseTo(100, 10);
  });

  it('matches the sim ship-wide form for a full repair (roundHalfEven on parts)', () => {
    // sim: round(2000 × 0.5 × 0.8 × (6/4)) + 2×100 = round(1200) + 200 = 1400
    const cost = repairCost(
      [part({ basePrice: 2000, fromCondition: 50, toCondition: 100 })],
      2,
      PARITY_ISO,
      PARITY_FACTION,
      rules,
    );
    expect(cost).toBeCloseTo(1400, 10);
  });
});

describe('S5.8 — fuel cost (sim form + location factor)', () => {
  it('matches the plan formula: round(fuelUse × dist / 100 × mult) × fuel_price × location', () => {
    // roundHalfEven(2.5 × 800 / 100 × 1) = 20; × 3 × 1 = 60
    expect(fuelCost(fuel(), rules)).toBeCloseTo(60, 10);
  });

  it('applies env fuel_mult before rounding', () => {
    // 2.5 × 800 / 100 × 1.5 = 30; × 3 = 90
    expect(fuelCost(fuel({ envFuelMult: 1.5 }), rules)).toBeCloseTo(90, 10);
    // 2.5 × 800 / 100 × 1.1 = 22; × 3 = 66
    expect(fuelCost(fuel({ envFuelMult: 1.1 }), rules)).toBeCloseTo(66, 10);
  });

  it('rounds the distance term half-even (Python parity)', () => {
    // 1.2 × 50 / 100 = 0.6 → 1 (half-even of 0.6 is 1); actually 0.6 → 1
    // Use 2.5 × 10 / 100 = 0.25 → 0
    expect(fuelCost(fuel({ fuelUse: 2.5, distance: 10 }), rules)).toBeCloseTo(0, 10);
    // 3 × 50 / 100 = 1.5 → 2 (half-even)
    expect(fuelCost(fuel({ fuelUse: 3, distance: 50 }), rules)).toBeCloseTo(6, 10);
    // 3 × 10 / 100 = 0.3 → 0
    expect(fuelCost(fuel({ fuelUse: 3, distance: 10 }), rules)).toBeCloseTo(0, 10);
    // 1 × 500 / 100 = 5 → 5; × 3 = 15
    expect(fuelCost(fuel({ fuelUse: 1, distance: 500 }), rules)).toBeCloseTo(15, 10);
  });

  it('applies the location factor to the fuel cost', () => {
    // 20 units × 3 × (0.9 isolation × 0.8 ally) = 60 × 0.72 = 43.2
    expect(fuelCost(fuel({ isolation: 0.9, factionRelation: 'ally' }), rules)).toBeCloseTo(
      43.2,
      10,
    );
    // 20 × 3 × (2 × 2.5) = 300
    expect(fuelCost(fuel({ isolation: 2, factionRelation: 'hostile' }), rules)).toBeCloseTo(
      300,
      10,
    );
  });

  it('pins parity geometry to factor 1.0', () => {
    expect(locationFactor(PARITY_ISO, PARITY_FACTION, rules)).toBe(1);
  });
});

describe('S8.3 — refuel cost (raw tank units × fuel_price × location factor)', () => {
  it('prices raw units with fuel_price and the location factor', () => {
    // 1000 units × 3 × (0.9 isolation × neutral) = 2700
    expect(refuelCost(1000, 0.9, 'neutral', rules)).toBeCloseTo(2700, 10);
    // 250 × 3 × (2 × 2.5 hostile) = 3750
    expect(refuelCost(250, 2, 'hostile', rules)).toBeCloseTo(3750, 10);
    // 100 × 3 × (1.4 × 0.8 ally) = 336
    expect(refuelCost(100, 1.4, 'ally', rules)).toBeCloseTo(336, 10);
  });

  it('is linear: zero units cost nothing, doubling units doubles cost', () => {
    expect(refuelCost(0, 2, 'hostile', rules)).toBe(0);
    expect(refuelCost(200, 0.9, 'neutral', rules)).toBe(2 * refuelCost(100, 0.9, 'neutral', rules));
  });

  it('uses only isolation × faction (no mood term, per plan S5.8)', () => {
    // The transit geometry burns 20 units, so the credit-denominated fuelCost and
    // the raw-unit refuelCost must agree — and neither carries a mood multiplier.
    const units = fuelUnits(fuel());
    expect(units).toBe(20);
    expect(refuelCost(units, 0.9, 'ally', rules)).toBeCloseTo(
      fuelCost(fuel({ isolation: 0.9, factionRelation: 'ally' }), rules),
      10,
    );
  });
});

describe('repair of a part worth nothing (the bridge)', () => {
  it('is never free: a part cheaper than the minimum base is repaired as if it cost the minimum', () => {
    const parts = [{ basePrice: 0, fromCondition: 0, toCondition: 100 }];
    const cost = repairCost(parts, 0, 1, 'neutral', rules);
    // 50 (min base) × 100 % × 0.8 (repair_factor) × 6/4 (price ratio) = 60
    expect(cost).toBe(60);
    // ...and a part worth more than the minimum is unaffected by it.
    expect(
      repairCost([{ basePrice: 200, fromCondition: 0, toCondition: 100 }], 0, 1, 'neutral', rules),
    ).toBe(240);
  });

  it('a no-change target costs nothing', () => {
    expect(
      repairCost([{ basePrice: 0, fromCondition: 80, toCondition: 80 }], 0, 1, 'neutral', rules),
    ).toBe(0);
  });
});
