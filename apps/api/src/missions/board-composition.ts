import type { MissionType } from '@prisma/client';
import type { GameRules } from '../config/game-config.types.js';

/** What a board still lacks in trip length: a long offer or a short one. */
export type LengthNeed = 'short' | 'long';

/** Types that never take a board slot, whatever `board_core_types` says. */
const NOT_BOARD_TYPES: ReadonlySet<string> = new Set(['TRAVEL', 'SCAVENGE']);

/** What one mission type can post from a place: how many destinations and the nearest/farthest trip in seconds. */
export interface TypeReach {
  readonly destinations: number;
  readonly nearestSeconds: number;
  readonly farthestSeconds: number;
}

/** Per mission type, what the place can post. Types the place cannot post are absent. */
export type BoardReach = ReadonlyMap<MissionType, TypeReach>;

export interface LiveOffer {
  readonly type: MissionType;
  readonly seconds: number;
}

/** A trip up to `shortMax` is short; from `longMin` it is long. Both are clamped to what the place can reach. */
export interface LengthBounds {
  readonly shortMax: number;
  readonly longMin: number;
}

/** The next offer to post: restricted to these types and/or to this length. An empty slot is unconstrained. */
export interface BoardSlot {
  readonly types?: ReadonlySet<MissionType>;
  readonly length?: LengthNeed;
}

export function lengthBounds(reach: BoardReach, rules: GameRules): LengthBounds | null {
  if (reach.size === 0) return null;
  let nearest = Infinity;
  let farthest = -Infinity;
  for (const r of reach.values()) {
    nearest = Math.min(nearest, r.nearestSeconds);
    farthest = Math.max(farthest, r.farthestSeconds);
  }
  return {
    shortMax: Math.max(rules.missions.board_short_max_seconds, nearest),
    longMin: Math.min(rules.missions.board_long_min_seconds, farthest),
  };
}

/** The core types the place can post, in order, then one RACE per race destination up to `board_min_races`. */
export function requiredTypes(reach: BoardReach, rules: GameRules): MissionType[] {
  const required = rules.missions.board_core_types.filter(
    (t): t is MissionType => reach.has(t as MissionType) && !NOT_BOARD_TYPES.has(t),
  );
  const races = Math.min(rules.missions.board_min_races, reach.get('RACE')?.destinations ?? 0);
  for (let i = 0; i < races; i += 1) required.push('RACE');
  return required;
}

/** `board_extra_types` the place can post, in config order: never a core or NOT_BOARD type, never a duplicate. */
export function extraTypes(reach: BoardReach, rules: GameRules): MissionType[] {
  const core = new Set(rules.missions.board_core_types);
  const seen = new Set<string>();
  const out: MissionType[] = [];
  for (const t of rules.missions.board_extra_types) {
    if (seen.has(t) || core.has(t) || NOT_BOARD_TYPES.has(t) || !reach.has(t as MissionType)) {
      continue;
    }
    seen.add(t);
    out.push(t as MissionType);
  }
  return out;
}

/** How many extra offers a board keeps: `board_min_extras`, 0 when the place can post no extra type. */
function wantedExtras(reach: BoardReach, rules: GameRules): number {
  const n = rules.missions.board_min_extras;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return extraTypes(reach, rules).length > 0 ? Math.floor(n) : 0;
}

export function boardTarget(baseSize: number, reach: BoardReach, rules: GameRules): number {
  return Math.max(baseSize, requiredTypes(reach, rules).length + wantedExtras(reach, rules));
}

function canServe(r: TypeReach, need: LengthNeed, bounds: LengthBounds): boolean {
  return need === 'long'
    ? r.farthestSeconds >= bounds.longMin
    : r.nearestSeconds <= bounds.shortMax;
}

export function nextSlot(input: {
  readonly reach: BoardReach;
  readonly live: readonly LiveOffer[];
  readonly capped: ReadonlySet<MissionType>;
  readonly rules: GameRules;
}): BoardSlot {
  const { reach, live, capped, rules } = input;
  const bounds = lengthBounds(reach, rules);
  if (!bounds) return {};

  const counts = new Map<MissionType, number>();
  for (const o of live) counts.set(o.type, (counts.get(o.type) ?? 0) + 1);
  const missing: MissionType[] = [];
  for (const t of requiredTypes(reach, rules)) {
    const have = counts.get(t) ?? 0;
    if (have > 0) counts.set(t, have - 1);
    else if (!capped.has(t)) missing.push(t);
  }

  const needs: LengthNeed[] = [];
  if (!live.some((o) => o.seconds >= bounds.longMin)) needs.push('long');
  if (!live.some((o) => o.seconds <= bounds.shortMax)) needs.push('short');

  if (missing.length > 0) {
    for (const need of needs) {
      const type = missing.find((t) => canServe(reach.get(t)!, need, bounds));
      if (type) return { types: new Set([type]), length: need };
    }
    return { types: new Set(missing.slice(0, 1)) };
  }

  // The extras slot: a board with room keeps `board_min_extras` offers of the extra types (EXPLORE) before length needs.
  const extras = extraTypes(reach, rules);
  const wanted = wantedExtras(reach, rules);
  if (wanted > 0) {
    const extraSet = new Set<MissionType>(extras);
    const liveExtras = live.filter((o) => extraSet.has(o.type)).length;
    const open = extras.filter((t) => !capped.has(t));
    if (liveExtras < wanted && open.length > 0) return { types: new Set(open) };
  }

  // A need no uncapped type can serve is skipped: asking the filler for a length it cannot meet only burns reseeds.
  for (const need of needs) {
    const serving = [...reach.keys()].filter(
      (t) => !capped.has(t) && canServe(reach.get(t)!, need, bounds),
    );
    if (serving.length > 0) return { types: new Set(serving), length: need };
  }

  const liveTypes = new Set(live.map((o) => o.type));
  const lacking = [...reach.keys()].filter((t) => !liveTypes.has(t) && !capped.has(t));
  return lacking.length > 0 && lacking.length < reach.size ? { types: new Set(lacking) } : {};
}
