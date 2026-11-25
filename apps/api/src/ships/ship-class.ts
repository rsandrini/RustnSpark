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

// The types by main point, in the fixed order that breaks an exact tie (the first listed wins).
// Range has no type of its own; the two combat axes share one (the better of them counts).
const TYPE_ORDER: readonly { type: ShipClassType; score: (p: ShipProfile) => number }[] = [
  { type: 'HAULER', score: (p) => p.cargo },
  { type: 'TRANSPORT', score: (p) => p.passengers },
  { type: 'WARSHIP', score: (p) => Math.max(p.firepower, p.defense) },
  { type: 'MINER', score: (p) => p.mining },
  { type: 'RACER', score: (p) => p.mobility },
];

export function deriveShipIdentity(profile: ShipProfile, rules: GameRules): ShipIdentity {
  const cfg = rules.ship_profile;
  const ranked = TYPE_ORDER.map((entry, index) => ({
    ...entry,
    value: entry.score(profile),
    index,
  })).sort((a, b) => b.value - a.value || a.index - b.index);
  const top = ranked[0];
  const second = ranked[1];
  if (top === undefined || second === undefined) return { shipClass: 'BALANCED', modifier: null };
  if (top.value < cfg.min_main || top.value - second.value < cfg.lead_margin) {
    return { shipClass: 'BALANCED', modifier: null };
  }
  // The axes the type already names are not repeated as its modifier.
  const named: readonly ProfileAxis[] =
    top.type === 'WARSHIP'
      ? [profile.firepower >= profile.defense ? 'firepower' : 'defense']
      : [
          top.type === 'HAULER'
            ? 'cargo'
            : top.type === 'TRANSPORT'
              ? 'passengers'
              : top.type === 'MINER'
                ? 'mining'
                : 'mobility',
        ];
  let modifier: ProfileAxis | null = null;
  let best = cfg.second_min;
  for (const key of PROFILE_AXES) {
    if (named.includes(key)) continue;
    // `>=` on the first and `>` after it: the earlier axis in PROFILE_AXES wins a tie.
    if (modifier === null ? profile[key] >= best : profile[key] > best) {
      modifier = key;
      best = profile[key];
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
