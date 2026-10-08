import type { MissionType } from '@prisma/client';
import type { GameRules } from '../config/game-config.types.js';
import type { InstalledPart } from '../parts/part.types.js';
import { rawMobility } from '../ships/sheet.deriver.js';
import type { ShipSheet } from '../ships/sheet.types.js';

export type RequirementReasonCode =
  | 'CARGO_TYPE'
  | 'PRESSURIZED_LIFE_SUPPORT'
  | 'WEAPONS'
  | 'MIN_MOBILITY'
  | 'MINER'
  | 'SPEED'
  | 'RACE_SPEED';

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

const RACE_SPEED: RequirementReason = {
  code: 'RACE_SPEED',
  message: 'Mobility is below the race entry minimum.',
};

const ESCORT_MOBILITY_MIN = 2;

/**
 * A mobility threshold as a number the player can compare with the ship sheet. The game rounds a
 * ship's mobility to a whole number before comparing ("mobility 2" means 1.5 or more), while the
 * sheet shows the unrounded figure; this is the exact unrounded equivalent, so what the player
 * reads and what the game decides always agree (needs 2 → shows 1.5 × the display scale).
 */
const HALF = 0.5;

export function unroundedThreshold(threshold: number): number {
  return Math.ceil(threshold) - HALF;
}

export interface MissionRequirementInput {
  readonly missionType: MissionType;
  readonly requirements?: unknown;
  readonly sheet: ShipSheet;
  readonly parts: readonly InstalledPart[];
}

interface RequirementHints {
  readonly cargo?: number;
  readonly speed?: number;
  /** RACE: the entry minimum for this template (else `race.min_mobility`). */
  readonly minMobility?: number;
}

function threshold(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseHints(requirements: unknown): RequirementHints {
  if (typeof requirements !== 'object' || requirements === null) {
    return {};
  }
  const record = requirements as Record<string, unknown>;
  return {
    cargo: threshold(record.cargo),
    speed: threshold(record.speed),
    minMobility: threshold(record.minMobility),
  };
}

/** What a numeric requirement compares: the ship has `actual` of `needed` (mobility in game units,
    unrounded — the web shows it on the display scale, like the ship sheet). */
export type RequirementUnit = 'mobility' | 'cargo' | 'mining';

export interface RequirementCheck extends RequirementReason {
  met: boolean;
  needed?: number;
  actual?: number;
  unit?: RequirementUnit;
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

  const mobility = rawMobility(sheet.pot, sheet.mass, rules);
  const numeric = (
    base: RequirementReason,
    unit: RequirementUnit,
    needed: number,
    actual: number,
    metOverride?: boolean,
  ): RequirementCheck => ({
    ...base,
    met: metOverride ?? actual >= needed,
    needed,
    actual,
    unit,
  });

  switch (missionType) {
    case 'DELIVERY':
      return [numeric(CARGO_TYPE, 'cargo', cargoNeeded, sheet.crg)];
    case 'TRANSPORT':
      return [{ ...PRESSURIZED_LIFE_SUPPORT, met: hasCabin }];
    case 'ESCORT':
      return [
        { ...WEAPONS, met: hasWeapon },
        numeric(MIN_MOBILITY, 'mobility', unroundedThreshold(ESCORT_MOBILITY_MIN), mobility),
      ];
    case 'MINING':
      return [
        numeric(MINER, 'mining', 1, sheet.min),
        numeric(CARGO_TYPE, 'cargo', cargoNeeded, sheet.crg),
      ];
    case 'TRAVEL':
    case 'SCAVENGE':
      // Nothing to check: any ship that can fly can make a trip (viability is checked separately).
      return [];
    case 'RACE':
      return [numeric(
          RACE_SPEED,
          'mobility',
          unroundedThreshold(hints.minMobility ?? rules.race.min_mobility),
          mobility,
        )];
    case 'RESCUE':
      return [
        numeric(CARGO_TYPE, 'cargo', cargoNeeded, sheet.crg, sheet.crg >= cargoNeeded || hasCabin),
        numeric(SPEED, 'mobility', unroundedThreshold(hints.speed ?? rules.rescue.reference_mob), mobility),
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
