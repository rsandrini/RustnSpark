import type { MissionType } from '@prisma/client';
import type { GameRules } from '../config/game-config.types.js';
import { headCountOf } from '../economy/reward.calculator.js';
import { deriveShipProfile, deriveShipProfileDetail } from '../ships/ship-profile.js';
import type { ShipSheet } from '../ships/sheet.types.js';
import type { RequirementReasonCode } from './requirements.checker.js';

/**
 * The specialty table: which ship stat drives each mission type, and how a weak ship is treated.
 *
 * To add a type: add one row to SPECIALTY_TABLE. A row that uses a curve (`power` or `trips`) also needs a knob
 * key `rules.specialty.<type>` (schema, types, defaults, registry en + pt-BR) that its `knobs` reads.
 *
 * Curves:
 * - `power`: time follows stat/need, `factor = max(fastest, (need / max(have, minimum)) ^ exponent)`;
 * - `trips`: a need above the stat is flown in several trips, `factor = 2 * trips - 1` (time only);
 * - `built-in`: the type's own rules handle it; no verdict here.
 * Below `minimum = need * min_ratio` the job is refused with the row's blocker. Pure functions, no I/O.
 */
export type SpecialtyStat = 'passengers' | 'combat' | 'mobility' | 'mining' | 'cargo';
export type SpecialtyCurve = 'power' | 'trips' | 'built-in';

export interface SpecialtyKnobs {
  readonly min_ratio: number;
  readonly exponent?: number;
  readonly fastest?: number;
  readonly reference?: number;
  readonly per_danger?: number;
}

/** `requirements` is the output of `offerRequirements(...)`. */
export interface SpecialtyOffer {
  readonly requirements: unknown;
  readonly peakDanger: number;
}

export interface SpecialtyRow {
  readonly stat: SpecialtyStat;
  readonly curve: SpecialtyCurve;
  readonly blocker: RequirementReasonCode | null;
  /** Whole units (people): the minimum is rounded up. Loads and strengths are not whole. */
  readonly wholeUnits: boolean;
  readonly knobs: ((rules: GameRules) => SpecialtyKnobs) | null;
  readonly needOf: ((offer: SpecialtyOffer, knobs: SpecialtyKnobs) => number) | null;
}

export interface SpecialtyVerdict {
  readonly stat: SpecialtyStat;
  readonly need: number;
  readonly have: number;
  readonly minimum: number;
  /** Time multiplier: 1 = as today, above 1 slower (trips), below 1 faster (power). */
  readonly factor: number;
  /** Trips flown (`trips` curve); null for `power`. */
  readonly trips: number | null;
  readonly met: boolean;
  readonly blocker: RequirementReasonCode;
}

function requirementRecord(offer: SpecialtyOffer): Record<string, unknown> {
  return typeof offer.requirements === 'object' && offer.requirements !== null
    ? (offer.requirements as Record<string, unknown>)
    : {};
}

export const SPECIALTY_TABLE: Readonly<Record<MissionType, SpecialtyRow | null>> = {
  TRANSPORT: {
    stat: 'passengers',
    curve: 'trips',
    blocker: 'PASSENGER_SEATS',
    wholeUnits: true,
    knobs: (rules) => rules.specialty.transport,
    needOf: (offer) => headCountOf(requirementRecord(offer)['passengers']),
  },
  // DELIVERY carries the cargo: the stat is the hold, the need is the load the ship would carry (`cargo.mode`
  // keeps its meaning: min/fixed/open all ask for `requirements.cargo`, default 1, as `cargoTermsOf` reads it).
  DELIVERY: {
    stat: 'cargo',
    curve: 'trips',
    blocker: 'CARGO_TYPE',
    wholeUnits: false,
    knobs: (rules) => rules.specialty.delivery,
    needOf: (offer) => {
      const cargo = requirementRecord(offer)['cargo'];
      return typeof cargo === 'number' && cargo > 0 ? cargo : 1;
    },
  },
  ESCORT: {
    stat: 'combat',
    curve: 'power',
    blocker: 'ESCORT_STRENGTH',
    wholeUnits: false,
    knobs: (rules) => rules.specialty.escort,
    needOf: (offer, knobs) => (knobs.reference ?? 0) + (knobs.per_danger ?? 0) * offer.peakDanger,
  },
  RACE: {
    stat: 'mobility',
    curve: 'built-in',
    blocker: null,
    wholeUnits: false,
    knobs: null,
    needOf: null,
  },
  RESCUE: {
    stat: 'mobility',
    curve: 'built-in',
    blocker: null,
    wholeUnits: false,
    knobs: null,
    needOf: null,
  },
  MINING: {
    stat: 'mining',
    curve: 'built-in',
    blocker: null,
    wholeUnits: false,
    knobs: null,
    needOf: null,
  },
  TRAVEL: null,
  SCAVENGE: null,
};

/** Each extra trip goes there and back. */
const LEGS_PER_TRIP = 2;
const MEAN_OF = 2;
const FLOAT_DECIMALS = 9;

/**
 * The least of the need a ship can take: `need * ratio`, trimmed first so float error (30 * 0.1 =
 * 3.0000000000000004) never refuses a stat that is exactly the minimum; whole units (people) round up (3 of 5 at 0.5).
 */
export function specialtyMinimum(need: number, ratio: number, wholeUnits: boolean): number {
  const trimmed = Number((need * ratio).toFixed(FLOAT_DECIMALS));
  return wholeUnits ? Math.ceil(trimmed) : trimmed;
}

/**
 * What the ship has of a stat: seats the life support can keep alive (people), the hold (units), or a 0..1
 * profile axis (combat is the mean of firepower and defense).
 */
export function specialtyStat(stat: SpecialtyStat, sheet: ShipSheet, rules: GameRules): number {
  switch (stat) {
    case 'passengers':
      return deriveShipProfileDetail(sheet, rules).passengers.value;
    case 'cargo':
      return sheet.crg;
    case 'combat': {
      const profile = deriveShipProfile(sheet, rules);
      return (profile.firepower + profile.defense) / MEAN_OF;
    }
    case 'mobility':
      return deriveShipProfile(sheet, rules).mobility;
    case 'mining':
      return deriveShipProfile(sheet, rules).mining;
  }
}

export function specialtyOf(
  type: MissionType,
  offer: SpecialtyOffer,
  sheet: ShipSheet,
  rules: GameRules,
): SpecialtyVerdict | null {
  const row = SPECIALTY_TABLE[type];
  if (row === null || row.curve === 'built-in') return null;
  if (row.knobs === null || row.needOf === null || row.blocker === null) return null;
  const knobs = row.knobs(rules);
  // A NaN or infinite need or stat (bad data) counts as 0, so no NaN ever leaves this function: a zero need is
  // always met, a zero stat is refused (when the minimum is above 0), and every number below stays finite.
  const finite = (value: number): number => (Number.isFinite(value) ? value : 0);
  const need = finite(row.needOf(offer, knobs));
  const have = finite(specialtyStat(row.stat, sheet, rules));
  const minimum = specialtyMinimum(need, knobs.min_ratio, row.wholeUnits);
  const met = have >= minimum;
  // The divisor is never below the minimum, so a zero stat gives a finite factor (the job is refused anyway).
  const divisor = Math.max(have, minimum);
  if (row.curve === 'power') {
    const ratio = divisor > 0 ? need / divisor : 1;
    const factor = Math.max(knobs.fastest ?? 0, ratio ** (knobs.exponent ?? 1));
    return { stat: row.stat, need, have, minimum, factor, trips: null, met, blocker: row.blocker };
  }
  const trips = divisor > 0 ? Math.max(1, Math.ceil(need / divisor)) : 1;
  return {
    stat: row.stat,
    need,
    have,
    minimum,
    factor: LEGS_PER_TRIP * trips - 1,
    trips,
    met,
    blocker: row.blocker,
  };
}

/**
 * The time multiplier a mission is planned with: the verdict's factor, met or not (1 when the type has no verdict).
 * An unmet verdict's factor is the slowest the curve allows (the divisor is clamped to the minimum), so a ship just
 * below the minimum never flies faster than one that just meets it: no cliff back to 1.
 */
export function specialtyStretch(
  type: MissionType,
  offer: SpecialtyOffer,
  sheet: ShipSheet,
  rules: GameRules,
): number {
  const verdict = specialtyOf(type, offer, sheet, rules);
  return verdict?.factor ?? 1;
}

/** The highest per-leg danger (0..10) of a route: what an escort's need grows with. Reads stored or parsed legs. */
export function peakDangerOf(rawLegs: unknown): number {
  const legs = (Array.isArray(rawLegs) ? rawLegs : []) as ReadonlyArray<{
    readonly danger?: number;
  }>;
  return legs.reduce((peak, leg) => Math.max(peak, leg.danger ?? 0), 0);
}
