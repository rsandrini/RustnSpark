import type { MissionType } from '@prisma/client';
import type { GameRules } from '../config/game-config.types.js';
import type { InstalledPart } from '../parts/part.types.js';
import type { ShipSheet } from '../ships/sheet.types.js';

export type RequirementReasonCode =
  'CARGO_TYPE' | 'PRESSURIZED_LIFE_SUPPORT' | 'WEAPONS' | 'MIN_MOBILITY' | 'MINER' | 'SPEED';

export interface RequirementReason {
  code: RequirementReasonCode;
  message: string;
}

const CARGO_TYPE: RequirementReason = {
  code: 'CARGO_TYPE',
  message: 'Ship lacks the cargo capacity this mission requires.',
};
const PRESSURIZED_LIFE_SUPPORT: RequirementReason = {
  code: 'PRESSURIZED_LIFE_SUPPORT',
  // Two separate parts, not one: a Passenger Cabin (pressurized) AND a Life Support module —
  // named explicitly since a player installing only one of them (usually Life Support alone)
  // is the actual confusion this message needs to head off.
  message: 'Mission requires a Passenger Cabin and a Life Support module, both installed.',
};
const WEAPONS: RequirementReason = {
  code: 'WEAPONS',
  message: 'Mission requires at least one installed weapon.',
};
const MIN_MOBILITY: RequirementReason = {
  code: 'MIN_MOBILITY',
  message: 'Mobility is below the escort minimum.',
};
const MINER: RequirementReason = {
  code: 'MINER',
  message: 'Mission requires mining equipment.',
};
const SPEED: RequirementReason = {
  code: 'SPEED',
  message: 'Mobility is below the rescue reference speed.',
};

const ESCORT_MOBILITY_MIN = 2;

export interface MissionRequirementInput {
  readonly missionType: MissionType;
  readonly requirements?: unknown;
  readonly sheet: ShipSheet;
  readonly parts: readonly InstalledPart[];
}

interface RequirementHints {
  readonly cargo?: number;
  readonly speed?: number;
}

function threshold(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseHints(requirements: unknown): RequirementHints {
  if (typeof requirements !== 'object' || requirements === null) {
    return {};
  }
  const record = requirements as Record<string, unknown>;
  return { cargo: threshold(record.cargo), speed: threshold(record.speed) };
}

export interface RequirementCheck extends RequirementReason {
  met: boolean;
}

/**
 * The full set of requirement checks for a mission type, each always returned with a `met`
 * flag — unlike `reasons` below, this never omits a requirement just because the ship
 * already satisfies it, so a UI can show "what this mission needs" before the ship fails it.
 */
export function missionRequirementChecklist(
  input: MissionRequirementInput,
  rules: GameRules,
): RequirementCheck[] {
  const { missionType, sheet, parts } = input;
  const hints = parseHints(input.requirements);
  const cargoNeeded = hints.cargo ?? 1;
  const hasCabin =
    parts.some((part) => part.catalog.pressurized) &&
    parts.some((part) => part.catalog.lifeSupport);
  const hasWeapon = parts.some((part) => part.catalog.partClass === 'WEAPON');

  switch (missionType) {
    case 'DELIVERY':
      return [{ ...CARGO_TYPE, met: sheet.crg >= cargoNeeded }];
    case 'TRANSPORT':
      return [{ ...PRESSURIZED_LIFE_SUPPORT, met: hasCabin }];
    case 'ESCORT':
      return [
        { ...WEAPONS, met: hasWeapon },
        { ...MIN_MOBILITY, met: sheet.mob >= ESCORT_MOBILITY_MIN },
      ];
    case 'MINING':
      return [
        { ...MINER, met: sheet.min >= 1 },
        { ...CARGO_TYPE, met: sheet.crg >= cargoNeeded },
      ];
    case 'TRAVEL':
    case 'SCAVENGE':
      // Nothing to check: any ship that can fly can make a trip (viability is checked separately).
      return [];
    case 'RESCUE':
      return [
        { ...CARGO_TYPE, met: sheet.crg >= cargoNeeded || hasCabin },
        { ...SPEED, met: sheet.mob >= (hints.speed ?? rules.rescue.reference_mob) },
      ];
  }
}

export function checkMissionRequirements(
  input: MissionRequirementInput,
  rules: GameRules,
): { eligible: boolean; reasons: RequirementReason[]; checklist: RequirementCheck[] } {
  const checklist = missionRequirementChecklist(input, rules);
  const reasons = checklist
    .filter((entry) => !entry.met)
    .map(({ code, message }) => ({ code, message }));
  return { eligible: reasons.length === 0, reasons, checklist };
}
