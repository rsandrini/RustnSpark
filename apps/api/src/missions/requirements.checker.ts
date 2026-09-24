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
  message: 'Mission requires a pressurized cabin with life support.',
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

export function checkMissionRequirements(
  input: MissionRequirementInput,
  rules: GameRules,
): { eligible: boolean; reasons: RequirementReason[] } {
  const { missionType, sheet, parts } = input;
  const hints = parseHints(input.requirements);
  const cargoNeeded = hints.cargo ?? 1;
  const hasCabin =
    parts.some((part) => part.catalog.pressurized) &&
    parts.some((part) => part.catalog.lifeSupport);
  const hasWeapon = parts.some((part) => part.catalog.partClass === 'WEAPON');
  const reasons: RequirementReason[] = [];

  switch (missionType) {
    case 'DELIVERY':
      if (sheet.crg < cargoNeeded) {
        reasons.push(CARGO_TYPE);
      }
      break;
    case 'TRANSPORT':
      if (!hasCabin) {
        reasons.push(PRESSURIZED_LIFE_SUPPORT);
      }
      break;
    case 'ESCORT':
      if (!hasWeapon) {
        reasons.push(WEAPONS);
      }
      if (sheet.mob < ESCORT_MOBILITY_MIN) {
        reasons.push(MIN_MOBILITY);
      }
      break;
    case 'MINING':
      if (sheet.min < 1) {
        reasons.push(MINER);
      }
      if (sheet.crg < cargoNeeded) {
        reasons.push(CARGO_TYPE);
      }
      break;
    case 'RESCUE':
      if (sheet.crg < cargoNeeded && !hasCabin) {
        reasons.push(CARGO_TYPE);
      }
      if (sheet.mob < (hints.speed ?? rules.rescue.reference_mob)) {
        reasons.push(SPEED);
      }
      break;
  }

  return { eligible: reasons.length === 0, reasons };
}
