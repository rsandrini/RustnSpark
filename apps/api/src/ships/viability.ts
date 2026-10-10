import type { GameRules } from '../config/game-config.types.js';
import type { InstalledPart } from '../parts/part.types.js';
import { allocatePower, powerPartOf } from '../resolution/power/power.js';
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
  | 'SHIELD_ENERGY_LOW'
  | 'NO_LIFE_SUPPORT'
  | 'LIFE_SUPPORT_UNPOWERED'
  | 'STRUCTURE_EXCEEDED'
  // The loose parts and the ore the ship carries do not fit its free slots plus its cargo space.
  | 'HOLD_OVER_CAPACITY'
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
  'SHIELD_ENERGY_LOW',
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
  message: 'The systems need more power than the ship generates: they will compete for it.',
};
const BATTERY_OUTPUT_INSUFFICIENT: ViabilityProblem = {
  code: 'BATTERY_OUTPUT_INSUFFICIENT',
  message: 'Combat energy demand exceeds what the ship generates plus its battery output.',
};
const BATTERY_CHARGE_INSUFFICIENT: ViabilityProblem = {
  code: 'BATTERY_CHARGE_INSUFFICIENT',
  message: 'Combat energy demand exceeds what the ship generates plus its battery charge.',
};
const SHIELD_ENERGY_LOW: ViabilityProblem = {
  code: 'SHIELD_ENERGY_LOW',
  message:
    'If the shield is in use it may run short of energy once the battery and the ship\'s spare power are spent.',
};
const NO_LIFE_SUPPORT: ViabilityProblem = {
  code: 'NO_LIFE_SUPPORT',
  message: 'Pressurized modules require an active life support part.',
};
const LIFE_SUPPORT_UNPOWERED: ViabilityProblem = {
  code: 'LIFE_SUPPORT_UNPOWERED',
  message: 'Life support does not get enough power: passengers would not survive the trip.',
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

  // Combat is powered first by what the rest of the ship generates beyond its own needs (the
  // surplus of cruising power); the batteries only have to cover what that cannot. A pilot who
  // picks the batteries-only mode takes that choice at their own risk (see the combat energy mode).
  // The shield only spends energy while it recovers, so it is judged apart from the weapons: a
  // weapons shortfall is a real warning, a shield that might run short is only a low note.
  const surplus = Math.max(0, sheet.energyCont);
  const totalDraw = Math.abs(Math.min(0, sheet.energyCombat));
  const shieldDraw = parts
    .filter((part) => part.catalog.esc > 0)
    .reduce((sum, part) => sum + Math.abs(Math.min(0, part.catalog.energyCombat)), 0);
  const weaponShortfall = Math.max(0, totalDraw - shieldDraw - surplus);
  if (weaponShortfall > sheet.batOutput) {
    problems.push(BATTERY_OUTPUT_INSUFFICIENT);
  }

  if (weaponShortfall > sheet.batCharge) {
    problems.push(BATTERY_CHARGE_INSUFFICIENT);
  }

  if (
    weaponShortfall <= sheet.batOutput &&
    Math.max(0, totalDraw - surplus) > sheet.batOutput
  ) {
    problems.push(SHIELD_ENERGY_LOW);
  }

  // Life support has priority right after the bridge; if even that cannot be powered to the
  // minimum, the quest it serves would fail, so the ship stays in port.
  const powerParts = parts.map((part) =>
    powerPartOf(part.instance.id, part.catalog, rules.power.idle_demand),
  );
  if (
    powerParts.some((part) => part.kind === 'life') &&
    allocatePower(powerParts, 'cruise', rules).byKind.life < rules.power.life_support_min
  ) {
    problems.push(LIFE_SUPPORT_UNPOWERED);
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
