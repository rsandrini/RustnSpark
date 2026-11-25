import type { GameRules } from '../config/game-config.types.js';
import {
  PROFILE_AXES,
  deriveShipProfile,
  type ProfileAxis,
  type ShipProfile,
} from './ship-profile.js';
import type { ShipSheet } from './sheet.types.js';

export type ShipClassType = 'HAULER' | 'TRANSPORT' | 'WARSHIP' | 'MINER' | 'RACER' | 'BALANCED';

export interface ShipIdentity {
  shipClass: ShipClassType;
  /** A strong second axis ("Hauler, armed"); null when there is none or the ship is Balanced. */
  modifier: ProfileAxis | null;
}

/** What the ship responses carry next to the sheet. */
export interface ShipIdentityBundle {
  shipClass: ShipClassType;
  profile: ShipProfile;
  profileModifier: ProfileAxis | null;
}

// The types, in the fixed order that breaks an exact tie (the first listed wins). Each type reads the profile
// axes it names; the two combat axes share one type (the better of them counts). Range has no type of its own.
const TYPE_ORDER: readonly {
  type: ShipClassType;
  axes: readonly ProfileAxis[];
  score: (p: ShipProfile) => number;
}[] = [
  { type: 'HAULER', axes: ['cargo'], score: (p) => p.cargo },
  { type: 'TRANSPORT', axes: ['passengers'], score: (p) => p.passengers },
  {
    type: 'WARSHIP',
    axes: ['firepower', 'defense'],
    score: (p) => Math.max(p.firepower, p.defense),
  },
  { type: 'MINER', axes: ['mining'], score: (p) => p.mining },
  { type: 'RACER', axes: ['mobility'], score: (p) => p.mobility },
];

// Boundary comparisons tolerate float noise (0.35 - 0.25 is 0.0999999...).
const EPSILON = 1e-9;

/**
 * The type is named from the profile's RELATIVE shape (each type axis' share of their sum), so an early ship
 * that is all cargo is a Hauler although its absolute values are small; the radar keeps the absolute values.
 * Balanced means the ship really has no main point: nearly empty, no axis holding `min_share` of the whole, or
 * a lead over the second share under `lead_margin`.
 *
 * The modifier is the strongest remaining axis (range included, the axes that named the type excluded) that is
 * either strong in absolute terms (`second_min`) or, for a type axis, holds at least `second_share` of the sum.
 */
export function deriveShipIdentity(profile: ShipProfile, rules: GameRules): ShipIdentity {
  const cfg = rules.ship_profile;
  const scored = TYPE_ORDER.map((entry, index) => ({
    ...entry,
    value: entry.score(profile),
    index,
  }));
  const total = scored.reduce((sum, entry) => sum + entry.value, 0);
  if (!(total > cfg.min_total + EPSILON)) return { shipClass: 'BALANCED', modifier: null };
  const ranked = [...scored].sort((a, b) => b.value - a.value || a.index - b.index);
  const top = ranked[0];
  const second = ranked[1];
  if (top === undefined || second === undefined) return { shipClass: 'BALANCED', modifier: null };
  const topShare = top.value / total;
  const lead = topShare - second.value / total;
  if (topShare < cfg.min_share - EPSILON || lead < cfg.lead_margin - EPSILON) {
    return { shipClass: 'BALANCED', modifier: null };
  }
  // A warship is named by its better combat axis only: the other one stays a candidate modifier.
  const named: ProfileAxis =
    top.type === 'WARSHIP'
      ? profile.firepower >= profile.defense
        ? 'firepower'
        : 'defense'
      : (top.axes[0] ?? 'cargo');
  const typeAxes = new Set<ProfileAxis>(TYPE_ORDER.flatMap((entry) => entry.axes));
  let modifier: ProfileAxis | null = null;
  let best = -1;
  for (const key of PROFILE_AXES) {
    if (key === named) continue;
    const value = profile[key];
    const strong = value >= cfg.second_min - EPSILON;
    const sizeable = typeAxes.has(key) && value / total >= cfg.second_share - EPSILON;
    // Strictly greater: the earlier axis in PROFILE_AXES wins a tie.
    if ((strong || sizeable) && value > 0 && value > best) {
      modifier = key;
      best = value;
    }
  }
  return { shipClass: top.type, modifier };
}

/** The class name alone, for callers that only show it. */
export function deriveShipClass(profile: ShipProfile, rules: GameRules): ShipClassType {
  return deriveShipIdentity(profile, rules).shipClass;
}

export function shipIdentityOf(sheet: ShipSheet, rules: GameRules): ShipIdentityBundle {
  const profile = deriveShipProfile(sheet, rules);
  const { shipClass, modifier } = deriveShipIdentity(profile, rules);
  return { shipClass, profile, profileModifier: modifier };
}
