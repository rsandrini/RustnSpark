import type { GameRules } from '../config/game-config.types.js';
import type { InstalledPart, PartCatalog } from '../parts/part.types.js';
import { performance } from '../parts/condition.js';
import { roundHalfEven } from '../resolution/numeric/round-half-even.js';
import type { ShipSheet } from './sheet.types.js';

// `autonomy` is the ship's RANGE: how much route distance a full tank covers (fuelCap ÷ fuelUse per
// 100 distance, ×100) — the field keeps its historical name because the resolution oracles pin
// it; the UI shows it as "Range" in distance units (see ships/route-coverage.ts for the routes).
const NO_AUTONOMY = 0;
const MIN_MOB = 1;
// Autonomy is reported as a percentage of one full tank's worth of fuel use.
const PERCENT = 100;

function sumStat(parts: InstalledPart[], stat: keyof PartCatalog): number {
  return parts.reduce((total, part) => total + (part.catalog[stat] as number), 0);
}

function averageCondition(parts: InstalledPart[]): number {
  if (parts.length === 0) {
    return 0;
  }
  const total = parts.reduce((sum, part) => sum + part.instance.condition, 0);
  return total / parts.length;
}

// Unrounded mobility; viability gates on this value (rounding could otherwise hide MOB < 1).
export function rawMobility(pot: number, mass: number, rules: GameRules): number {
  return mass === 0 ? 0 : (pot / mass) * rules.ship.mob_factor;
}

export function deriveSheet(parts: InstalledPart[], rules: GameRules): ShipSheet {
  const bridge = parts.find((part) => part.catalog.partClass === 'BRIDGE');
  const structureBudget = bridge === undefined ? 0 : Math.abs(bridge.catalog.structureCost);
  const structureUsed = parts
    .filter((part) => part.catalog.partClass !== 'BRIDGE')
    .reduce((total, part) => total + part.catalog.structureCost, 0);

  const fuelUse = sumStat(parts, 'fuelUse');
  const fuelCap = sumStat(parts, 'fuelCap');
  const pot = sumStat(parts, 'pot');
  // A full tank is part of the ship's mass; the factor is Admin-tunable and 0 by default.
  const mass = sumStat(parts, 'mass') + fuelCap * rules.ship.fuel_mass_per_unit;

  const mobRaw = rawMobility(pot, mass, rules);
  const mob = Math.max(MIN_MOB, roundHalfEven(mobRaw));

  return {
    pot,
    pdf: sumStat(parts, 'pdf'),
    bli: sumStat(parts, 'bli'),
    esc: sumStat(parts, 'esc'),
    sen: sumStat(parts, 'sen'),
    crg: sumStat(parts, 'crg'),
    min: sumStat(parts, 'min'),
    hp: sumStat(parts, 'partHp'),
    mass,
    energyCont: sumStat(parts, 'energyCont'),
    energyCombat: sumStat(parts, 'energyCombat'),
    batCharge: sumStat(parts, 'batCharge'),
    batOutput: sumStat(parts, 'batOutput'),
    batInput: sumStat(parts, 'batInput'),
    fuelCap,
    fuelUse,
    structureUsed,
    structureBudget,
    autonomy: fuelUse > 0 ? (fuelCap / fuelUse) * PERCENT : NO_AUTONOMY,
    mob,
    condition: averageCondition(parts),
  };
}

export function effectiveSheet(
  sheet: ShipSheet,
  parts: InstalledPart[],
  rules: GameRules,
): ShipSheet {
  const avgCondition = averageCondition(parts);
  const perf = performance(avgCondition, rules);
  return {
    ...sheet,
    hp: sheet.hp * perf,
    condition: avgCondition,
  };
}
