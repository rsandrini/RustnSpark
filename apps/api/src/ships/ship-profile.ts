import type { GameRules } from '../config/game-config.types.js';
import { rawMobility } from './sheet.deriver.js';
import type { ShipSheet } from './sheet.types.js';

export type ProfileAxis =
  'cargo' | 'passengers' | 'firepower' | 'defense' | 'mobility' | 'range' | 'mining';

/** Every axis of the ship, 0..1: the share of a full axis (the `ship_profile.ref_*` value) the ship reaches. */
export type ShipProfile = Readonly<Record<ProfileAxis, number>>;

/** The axes in their fixed order (also the order that breaks ties when picking a modifier). */
export const PROFILE_AXES: readonly ProfileAxis[] = [
  'cargo',
  'passengers',
  'firepower',
  'defense',
  'mobility',
  'range',
  'mining',
];

function axis(value: number, reference: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(reference) || reference <= 0 || value <= 0) {
    return value === Number.POSITIVE_INFINITY && reference > 0 ? 1 : 0;
  }
  return Math.min(1, value / reference);
}

/** The raw number an axis is computed from and the reference that makes it a full axis. */
export interface ProfileAxisDetail {
  value: number;
  ref: number;
}
export type ShipProfileDetail = Readonly<Record<ProfileAxis, ProfileAxisDetail>>;

/** The value and reference behind every axis: `deriveShipProfile` reads these, so the two never drift apart. */
export function deriveShipProfileDetail(sheet: ShipSheet, rules: GameRules): ShipProfileDetail {
  const ref = rules.ship_profile;
  // Seats without air do not count: the passengers a ship can carry are bounded by its life support.
  const passengers = Math.min(sheet.pax, sheet.lifeCap);
  // Armor is a pool in a fight: a point of it is worth `armor_pool_factor` of shield.
  const defense = sheet.esc + sheet.bli * rules.combat.armor_pool_factor;
  return {
    cargo: { value: sheet.crg, ref: ref.ref_cargo },
    passengers: { value: passengers, ref: ref.ref_passengers },
    firepower: { value: sheet.pdf, ref: ref.ref_firepower },
    defense: { value: defense, ref: ref.ref_defense },
    mobility: { value: rawMobility(sheet.pot, sheet.mass, rules), ref: ref.ref_mobility },
    // A ship with an engine that burns no fuel (ion) has unlimited range (the sheet's autonomy reads 0 for it):
    // a full axis, reported as value = ref.
    range: {
      value: sheet.fuelUse <= 0 && sheet.pot > 0 ? ref.ref_range : sheet.autonomy,
      ref: ref.ref_range,
    },
    mining: { value: sheet.min, ref: ref.ref_mining },
  };
}

export function deriveShipProfile(sheet: ShipSheet, rules: GameRules): ShipProfile {
  const detail = deriveShipProfileDetail(sheet, rules);
  const of = (key: ProfileAxis): number => axis(detail[key].value, detail[key].ref);
  return {
    cargo: of('cargo'),
    passengers: of('passengers'),
    firepower: of('firepower'),
    defense: of('defense'),
    mobility: of('mobility'),
    range: of('range'),
    mining: of('mining'),
  };
}
