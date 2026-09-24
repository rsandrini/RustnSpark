/**
 * Structured mission events (plan S5.9 / schema-doc §16 MissionLog).
 * Persist events only — never narrated text; views re-render from these shapes.
 */

export type MissionEventCategory =
  'combat' | 'environment' | 'loot' | 'failure' | 'payment' | 'transit';

export interface MissionLoot {
  readonly materialId: string;
  readonly quantity: number;
}

/** Who an event touched. `enemy` is the generated pirate (D23 — no NPC table). */
export interface MissionActors {
  readonly playerShipId: string;
  readonly clientShipId?: string;
  readonly enemy?: 'pirate';
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
  readonly type: string;
  readonly actors: MissionActors;
  readonly effects: MissionEventEffects;
  readonly magnitude: number;
}

export function missionEvent(input: {
  leg: number;
  category: MissionEventCategory;
  type: string;
  actors: MissionActors;
  magnitude?: number;
  hp?: number;
  condByPart?: Readonly<Record<string, number>>;
  credits?: number;
  loot?: readonly MissionLoot[];
}): MissionEvent {
  return {
    leg: input.leg,
    category: input.category,
    type: input.type,
    actors: input.actors,
    effects: {
      hp: input.hp ?? 0,
      condByPart: input.condByPart ?? {},
      credits: input.credits ?? 0,
      loot: input.loot ?? [],
    },
    magnitude: input.magnitude ?? 0,
  };
}
