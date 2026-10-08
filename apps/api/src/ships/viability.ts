import type { GameRules } from '../config/game-config.types.js';
import type { InstalledPart } from '../parts/part.types.js';
import { rawMobility } from './sheet.deriver.js';
import type { ShipSheet } from './sheet.types.js';

export type ViabilityProblemCode =
  | 'NO_BRIDGE'
  | 'NO_ENGINE'
  | 'MOB_TOO_LOW'
  | 'NO_FUEL_CAPACITY'
  | 'ENERGY_CRUISE_NEGATIVE'
  | 'BATTERY_OUTPUT_INSUFFICIENT'
  | 'BATTERY_CHARGE_INSUFFICIENT'
  | 'NO_LIFE_SUPPORT'
  | 'STRUCTURE_EXCEEDED'
  // Part direction rules (ships/direction.ts): reported like any other flight problem — saving a
  // layout is never blocked by them (a refit needs free placement), flying with them is.
  | 'EXHAUST_BLOCKED'
  | 'FACING_BLOCKED'
  | 'FACING_CONNECTOR';

export interface ViabilityProblem {
  code: ViabilityProblemCode;
  message: string;
}

/** What a viability check reports: `problems` keep the ship on the ground; `warnings` do not — the
    ship flies, but underpowered or misaligned (see ships/penalties.ts for what that costs). */
export interface ViabilityReport {
  viable: boolean;
  problems: ViabilityProblem[];
  warnings: ViabilityProblem[];
}

/** Everything that is a warning, not a block: energy shortfalls, missing life support and the
    direction rules. A ship that cannot move at all (no bridge/engine/fuel, structure over budget)
    is still refused. */
const SOFT_CODES: ReadonlySet<ViabilityProblemCode> = new Set<ViabilityProblemCode>([
  'ENERGY_CRUISE_NEGATIVE',
  'BATTERY_OUTPUT_INSUFFICIENT',
  'BATTERY_CHARGE_INSUFFICIENT',
  'NO_LIFE_SUPPORT',
  'EXHAUST_BLOCKED',
  'FACING_BLOCKED',
  'FACING_CONNECTOR',
]);

export function isSoftProblem(code: ViabilityProblemCode): boolean {
  return SOFT_CODES.has(code);
}

/** Splits a list of problems into the blocking ones and the warnings. */
export function classifyProblems(all: readonly ViabilityProblem[]): ViabilityReport {
  const problems = all.filter((problem) => !isSoftProblem(problem.code));
  const warnings = all.filter((problem) => isSoftProblem(problem.code));
  return { viable: problems.length === 0, problems, warnings };
}

const NO_BRIDGE: ViabilityProblem = { code: 'NO_BRIDGE', message: 'Ship has no bridge installed.' };
const NO_ENGINE: ViabilityProblem = { code: 'NO_ENGINE', message: 'Ship has no engine installed.' };
const MOB_TOO_LOW: ViabilityProblem = { code: 'MOB_TOO_LOW', message: 'Mobility is below 1.' };
const NO_FUEL_CAPACITY: ViabilityProblem = {
  code: 'NO_FUEL_CAPACITY',
  message: 'Chemical engine requires a fuel tank.',
};
const ENERGY_CRUISE_NEGATIVE: ViabilityProblem = {
  code: 'ENERGY_CRUISE_NEGATIVE',
  message: 'Continuous energy consumption exceeds generation.',
};
const BATTERY_OUTPUT_INSUFFICIENT: ViabilityProblem = {
  code: 'BATTERY_OUTPUT_INSUFFICIENT',
  message: 'Combat energy demand exceeds battery output.',
};
const BATTERY_CHARGE_INSUFFICIENT: ViabilityProblem = {
  code: 'BATTERY_CHARGE_INSUFFICIENT',
  message: 'Combat energy demand exceeds battery charge.',
};
const NO_LIFE_SUPPORT: ViabilityProblem = {
  code: 'NO_LIFE_SUPPORT',
  message: 'Pressurized modules require an active life support part.',
};
const STRUCTURE_EXCEEDED: ViabilityProblem = {
  code: 'STRUCTURE_EXCEEDED',
  message: 'Installed parts exceed the structure budget.',
};

export function checkViability(
  sheet: ShipSheet,
  parts: InstalledPart[],
  rules: GameRules,
): ViabilityReport {
  const problems: ViabilityProblem[] = [];

  const hasBridge = parts.some((part) => part.catalog.partClass === 'BRIDGE');
  if (!hasBridge) {
    problems.push(NO_BRIDGE);
  }

  const hasEngine = parts.some((part) => part.catalog.partClass === 'ENGINE');
  if (!hasEngine) {
    problems.push(NO_ENGINE);
  }

  if (rawMobility(sheet.pot, sheet.mass, rules) < 1) {
    problems.push(MOB_TOO_LOW);
  }

  const hasChemicalEngine = parts.some(
    (part) => part.catalog.partClass === 'ENGINE' && (part.catalog.fuelUse ?? 0) > 0,
  );
  if (hasChemicalEngine && sheet.fuelCap <= 0) {
    problems.push(NO_FUEL_CAPACITY);
  }

  if (sheet.energyCont < 0) {
    problems.push(ENERGY_CRUISE_NEGATIVE);
  }

  if (sheet.energyCombat < 0 && Math.abs(sheet.energyCombat) > sheet.batOutput) {
    problems.push(BATTERY_OUTPUT_INSUFFICIENT);
  }

  if (sheet.energyCombat < 0 && Math.abs(sheet.energyCombat) > sheet.batCharge) {
    problems.push(BATTERY_CHARGE_INSUFFICIENT);
  }

  const hasPressurized = parts.some((part) => part.catalog.pressurized);
  const hasLifeSupport = parts.some((part) => part.catalog.lifeSupport);
  if (hasPressurized && !hasLifeSupport) {
    problems.push(NO_LIFE_SUPPORT);
  }

  if (sheet.structureUsed > sheet.structureBudget) {
    problems.push(STRUCTURE_EXCEEDED);
  }

  return classifyProblems(problems);
}
