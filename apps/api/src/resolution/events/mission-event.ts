/**
 * Structured mission events (plan S5.9 / schema-doc §16 MissionLog).
 * Persist events only — never narrated text; views re-render from these shapes.
 *
 * schemaVersion 2 (S9.0 / D36) only ADDS optional fields — never renames a
 * type or a core field, so v1 rows stay readable and a projection that drops
 * `cascade`/`consequence`/`fuelLost` maps any v2 event back to its v1 shape.
 */

import type { FailureConsequence } from '../wear/failure.resolver.js';
import { roundHalfEven } from '../numeric/round-half-even.js';

/**
 * The closed set of mission-event type names (S9.1). Frozen: renaming any
 * entry would break stored logs and their report templates. Report templates
 * and the zod union are coverage-tested against this list; `missionEvent()`
 * only accepts members of it, so the compiler rejects new literals that are
 * not added here first.
 */
export const MISSION_EVENT_TYPES = [
  'leg_travel',
  'combat_win',
  'combat_loss',
  'combat_draw',
  'escaped',
  'escort_absorbed',
  'escort_client_destroyed',
  'fuel_exhausted',
  'mission_wear',
  'mission_payout',
  'pirate_demand',
  'scavenge_find',
  'race_result',
  'pvp_encounter',
  'mining',
  'mining_paid',
  'mining_partial_failure',
  'motor',
  'battery',
  'tank',
  'shield',
  'weapon',
  'sensor',
] as const;

export type MissionEventType = (typeof MISSION_EVENT_TYPES)[number];

export type MissionEventCategory =
  'combat' | 'environment' | 'loot' | 'failure' | 'payment' | 'transit';

export interface MissionLoot {
  readonly materialId: string;
  readonly quantity: number;
}

/**
 * GDD §15 damage cascade for one fight: how the incoming damage was split
 * across the player ship's layers, in the order shields → armor → hull.
 * All three are non-negative integers. `shield + armor + hp` equals the pre-armor
 * damage of the hits that landed, except where the hull pool bottomed out (hp is
 * what was actually lost, never below zero) or the 1-damage floor lifted a hit
 * that armor would have fully absorbed.
 */
export interface MissionDamageCascade {
  /** Damage soaked by shields (ESC). */
  readonly shield: number;
  /** Damage deflected by armor (BLI). */
  readonly armor: number;
  /** Damage that reached the hull HP pool (before any escort share). */
  readonly hp: number;
}

/**
 * One attack inside a fight's round-by-round log (playtest round-4 request: "combat is a
 * black box"). Same array on every combat event of the fight, same pattern as `cascade` —
 * `cascade` is this array's own totals. `attacker`/`hit`/`damage` etc. read from the PLAYER's
 * perspective (not the resolver's internal A/B slot), so the report never has to know which
 * side held slot A.
 */
export interface MissionCombatRound {
  /** 1-based round index. */
  readonly round: number;
  readonly attacker: 'player' | 'enemy';
  /** Natural d20 result (before firepower or first-strike bonus). */
  readonly roll: number;
  /** Attacker's own firepower, added to `roll` for the hit check — optional even on v2 (rows
      written before this field existed have `rounds` but no `pdf`/`bonus`, and must keep
      reading back fine, D36 — only ADD optional fields). */
  readonly pdf?: number;
  /** First-strike bonus actually applied to this attack (0 on every attack but the one that
      held it pending). Optional for the same reason as `pdf`. */
  readonly bonus?: number;
  readonly dc: number;
  readonly hit: boolean;
  /** Total damage before shield absorption (0 on a miss). */
  readonly damage: number;
  /** What armor (BLI) deflected (0 on a miss). */
  readonly armorAbsorbed: number;
  /** What the shield (ESC) absorbed (0 on a miss, or an empty shield). */
  readonly shieldAbsorbed: number;
  /** What actually reached the defender's hull: damage minus shieldAbsorbed (0 on a miss). */
  readonly hullDamage: number;
}

/** Who an event touched. `enemy` is the generated pirate (D23 — no NPC table);
 *  `opponentShipId` is the other player's ship on a PvP overlap (S7.5). */
export interface MissionActors {
  readonly playerShipId: string;
  readonly clientShipId?: string;
  readonly enemy?: 'pirate';
  readonly opponentShipId?: string;
}

/**
 * Effects always carry all four keys so deep-equal comparisons and log
 * replay stay stable; unused slots are zero / empty.
 */
export interface MissionEventEffects {
  /** Net HP change for the player ship (negative = damage taken). */
  readonly hp: number;
  /** partId → condition after this effect (absolute, not a delta). */
  readonly condByPart: Readonly<Record<string, number>>;
  /** Signed credit effect; failure events are always 0 (D13 / GDD §12). */
  readonly credits: number;
  readonly loot: readonly MissionLoot[];
}

export interface MissionEvent {
  /** Zero-based leg index; mission-level events use the last resolved leg. */
  readonly leg: number;
  readonly category: MissionEventCategory;
  readonly type: MissionEventType;
  readonly actors: MissionActors;
  readonly effects: MissionEventEffects;
  readonly magnitude: number;
  /** v2: layer split of the fight's damage on `combat_win`/`combat_loss`/
   *  `escort_absorbed` (S9.0). Same fight-level triple on every combat event
   *  of that fight; absent on v1 rows and on non-combat types. */
  readonly cascade?: MissionDamageCascade;
  /** v2 addition (round-4): every attack of the fight, in order, on the same event types as
   *  `cascade`. Optional even on v2 rows — absent on v1 rows and on any v2 row written before
   *  this field existed (D36: only ADD optional fields, never require one retroactively). */
  readonly rounds?: readonly MissionCombatRound[];
  /** v2: what the choke did (`FailureConsequence`) on the six part-failure
   *  types (S9.0). Absent on v1 rows and on non-part-failure types. */
  readonly consequence?: FailureConsequence;
  /** v2: fuel units a tank leak cost (S9.0). Present on `tank` only; stored
   *  half-even rounded to an integer so the jsonb round-trip is exact. */
  readonly fuelLost?: number;
  /** v2, `pirate_demand` only: what the pirate who won wanted. */
  readonly motive?: 'cargo' | 'parts' | 'territory';
  /** v2, `pirate_demand` only: instance ids of the storage parts taken. */
  readonly stolen?: readonly string[];
  /** v2, `race_result` only: the finishing place and everyone's time (fastest first). */
  readonly race?: {
    readonly place: number;
    readonly standings: readonly {
      readonly name: string;
      readonly mobility: number;
      readonly seconds: number;
      readonly you: boolean;
    }[];
  };
  /** v2, `scavenge_find` only: what the search turned up. */
  readonly found?: {
    readonly kind: 'part' | 'scrap';
    readonly partType: string;
    readonly condition: number;
  };
}

/**
 * Builds one event with every numeric field normalized to an integer.
 *
 * Why (S9.0, discovered by the replay suite): Prisma's JSON codec shortens
 * doubles to ~16 significant digits, so a 17-digit float stored in the log
 * comes back changed and strict replay comparisons fail — value-dependently,
 * which is worse than failing always. Game units are whole numbers anyway
 * (fuel, condition, HP, credits), so:
 * - sim-flavoured numbers round half-even (Python parity, D16d);
 * - credits round like the wallet does (resolve.service uses Math.round), and
 *   with integer combat credits the per-event rounding sums to the wallet
 *   movement exactly.
 * Exact sim state keeps living in its own float8 columns
 * (Ship.fuel, PartInstance.condition) — only the rendered event is integral.
 */
function roundInt(value: number): number {
  return roundHalfEven(value);
}

function roundInts(record: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, roundInt(value)]));
}

export function missionEvent(input: {
  leg: number;
  category: MissionEventCategory;
  type: MissionEventType;
  actors: MissionActors;
  magnitude?: number;
  hp?: number;
  condByPart?: Readonly<Record<string, number>>;
  credits?: number;
  loot?: readonly MissionLoot[];
  cascade?: MissionDamageCascade;
  rounds?: readonly MissionCombatRound[];
  consequence?: FailureConsequence;
  fuelLost?: number;
  motive?: 'cargo' | 'parts' | 'territory';
  stolen?: readonly string[];
  found?: { kind: 'part' | 'scrap'; partType: string; condition: number };
  race?: MissionEvent['race'];
}): MissionEvent {
  return {
    leg: input.leg,
    category: input.category,
    type: input.type,
    actors: input.actors,
    effects: {
      hp: roundInt(input.hp ?? 0),
      condByPart: roundInts(input.condByPart ?? {}),
      credits: Math.round(input.credits ?? 0),
      loot: (input.loot ?? []).map((entry) => ({
        materialId: entry.materialId,
        quantity: roundInt(entry.quantity),
      })),
    },
    magnitude: roundInt(input.magnitude ?? 0),
    ...(input.cascade !== undefined
      ? {
          cascade: {
            shield: roundInt(input.cascade.shield),
            armor: roundInt(input.cascade.armor),
            hp: roundInt(input.cascade.hp),
          },
        }
      : {}),
    ...(input.rounds !== undefined
      ? {
          rounds: input.rounds.map((round) => ({
            round: roundInt(round.round),
            attacker: round.attacker,
            roll: roundInt(round.roll),
            ...(round.pdf !== undefined ? { pdf: roundInt(round.pdf) } : {}),
            ...(round.bonus !== undefined ? { bonus: roundInt(round.bonus) } : {}),
            dc: roundInt(round.dc),
            hit: round.hit,
            damage: roundInt(round.damage),
            armorAbsorbed: roundInt(round.armorAbsorbed),
            shieldAbsorbed: roundInt(round.shieldAbsorbed),
            hullDamage: roundInt(round.hullDamage),
          })),
        }
      : {}),
    ...(input.consequence !== undefined ? { consequence: input.consequence } : {}),
    ...(input.fuelLost !== undefined ? { fuelLost: roundInt(input.fuelLost) } : {}),
    ...(input.motive !== undefined ? { motive: input.motive } : {}),
    ...(input.stolen !== undefined ? { stolen: [...input.stolen] } : {}),
    ...(input.race !== undefined
      ? {
          race: {
            place: roundInt(input.race.place),
            standings: input.race.standings.map((standing) => ({
              name: standing.name,
              // two decimals are meaningful for a speed, but the stored log must round-trip
              // exactly through jsonb, so speeds are kept in hundredths as integers elsewhere;
              // here they are plain numbers rounded to 2 places (exactly representable on read)
              mobility: Math.round(standing.mobility * 100) / 100,
              seconds: roundInt(standing.seconds),
              you: standing.you,
            })),
          },
        }
      : {}),
    ...(input.found !== undefined
      ? {
          found: {
            kind: input.found.kind,
            partType: input.found.partType,
            condition: roundInt(input.found.condition),
          },
        }
      : {}),
  };
}
