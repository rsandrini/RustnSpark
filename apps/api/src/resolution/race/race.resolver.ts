import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';
import { mishapChance } from '../engine/engine.js';

/** A rival ship on a RACE mission's grid: generated with the offer, frozen in its cargo. */
export interface RaceCompetitor {
  readonly id: string;
  readonly name: string;
  /** Mobility: the same speed stat a player ship has (thrust over mass). */
  readonly mobility: number;
  /**
   * The engine level this rival runs at for the whole race (1 = as listed, above 1 = pushed: faster
   * and it can fail, exactly like the player's own tuning). Fixed with the offer; absent = 1.
   */
  readonly level?: number;
}

export interface RaceStanding {
  readonly name: string;
  readonly mobility: number;
  /** Finish time in seconds (before the mission time scale). */
  readonly seconds: number;
  readonly you: boolean;
  /** What went wrong for this ship on the day, if anything (it cost time). */
  readonly trouble?: 'mishap' | 'overheat';
}

/** One ship's leg: its time on the leg, its running total and whether an engine failed on it. */
export interface RaceLegStanding {
  readonly name: string;
  readonly you: boolean;
  readonly legSeconds: number;
  readonly totalSeconds: number;
  readonly trouble: boolean;
}

export interface RaceResult {
  /** The order after each leg (leading ship first); the last one is the final order. */
  readonly legs: readonly { readonly standings: readonly RaceLegStanding[] }[];
  /** Fastest first. */
  readonly standings: readonly RaceStanding[];
  /** The player's finishing place, 1-based. */
  readonly place: number;
  /** Share of the base reward that place pays (0 outside the podium). */
  readonly prizeShare: number;
}

const RIVAL_NAMES = [
  'Comet Runner',
  'Vega Dart',
  'Halo Sprint',
  'Ion Wasp',
  'Kestrel Blue',
  'Nova Thief',
  'Quasar Kid',
  'Rift Skipper',
  'Silver Tern',
  'Tango Drift',
  'Ember Fox',
  'Zenith Rook',
  'Orbit Hare',
  'Pulsar Jay',
  'Lumen Viper',
  'Cinder Gull',
];

const MIN_MOBILITY = 0.5;
/** The field never shrinks below this share of its drawn speeds, whatever the player's speed. */
const MIN_FIELD_SCALE = 0.5;
const ROUND_FACTOR = 100;
/** A rival's engine level moves in steps of a tenth. */
const LEVEL_STEPS_PER_UNIT = 10;
const SECOND_PLACE = 2;
const THIRD_PLACE = 3;

function roundTo2(value: number): number {
  return Math.round(value * ROUND_FACTOR) / ROUND_FACTOR;
}

/** A rival's engine level: most run as listed, some push (a level above 1, up to the chemical top). */
function rivalLevel(rng: Rng, rules: GameRules): number {
  const top = rules.engine.chem_level_max;
  if (top <= 1 || rng.child('push').float() >= rules.race.rival_push_chance) return 1;
  const tenths = Math.round((top - 1) * LEVEL_STEPS_PER_UNIT);
  return 1 + rng.child('level').int(1, Math.max(1, tenths)) / LEVEL_STEPS_PER_UNIT;
}

/**
 * The rivals of one race: 3-5 (admin-tunable) ships whose speeds are drawn around the reference.
 * A rival's speed and engine level are fixed here and kept to the end of the race, like the
 * player's own tuning is.
 */
export function generateCompetitors(rng: Rng, rules: GameRules): RaceCompetitor[] {
  const { competitors_min: low, competitors_max: high, reference_mob, speed_spread } = rules.race;
  const count = rng.child('count').int(Math.min(low, high), Math.max(low, high));
  const names = [...RIVAL_NAMES];
  const speedRng = rng.child('speed');
  const nameRng = rng.child('name');
  const field: RaceCompetitor[] = [];
  for (let index = 0; index < count; index += 1) {
    const name = names.splice(nameRng.int(0, names.length - 1), 1)[0] ?? `Rival ${index + 1}`;
    const mobility = Math.max(
      MIN_MOBILITY,
      roundTo2(reference_mob * (1 + speedRng.uniform(-speed_spread, speed_spread))),
    );
    const level = rivalLevel(rng.child(`rival-${index + 1}`), rules);
    field.push({ id: `rival-${index + 1}`, name, mobility, ...(level > 1 ? { level } : {}) });
  }
  return field;
}

/** Finish time of a ship over `distance`: the same `distance / mobility × duration_k` the player's
    own mission duration uses, so a faster ship really does arrive earlier. */
export function raceSeconds(distance: number, mobility: number, rules: GameRules): number {
  return Math.round((distance / Math.max(mobility, MIN_MOBILITY)) * rules.missions.duration_k);
}

/**
 * The field as the player meets it: the rivals' drawn speeds follow the player's own speed part of
 * the way (`race.field_follow`), so a much faster ship still leads but never laps a field that stayed
 * at the starter speed.
 */
export function fieldFor(
  competitors: readonly RaceCompetitor[],
  playerMobility: number,
  rules: GameRules,
): RaceCompetitor[] {
  const { reference_mob, field_follow } = rules.race;
  const scale = Math.max(MIN_FIELD_SCALE, 1 + field_follow * (playerMobility / reference_mob - 1));
  return competitors.map((rival) => ({
    ...rival,
    mobility: Math.max(MIN_MOBILITY, roundTo2(rival.mobility * scale)),
  }));
}

export interface RaceWindow {
  /** Where the ship usually finishes: its listed speed, no luck, no trouble. */
  readonly expected: number;
  /** A great day: best luck on every leg. */
  readonly best: number;
  /** A bad day: worst luck on every leg and (when it can happen) trouble. */
  readonly worst: number;
}

/**
 * What a ship's time can be over `distance`, for the board: the expected time and the range the
 * per-leg luck and trouble can move it through. `mobility` is the ship's speed as it races (a pushed
 * rival's already includes its level); `canHaveTrouble` is true for every ship that can have an
 * engine failure (all of them: the base chance applies to everyone).
 */
export function raceWindow(input: {
  readonly distance: number;
  readonly mobility: number;
  readonly rules: GameRules;
  readonly canHaveTrouble: boolean;
}): RaceWindow {
  const { distance, mobility, rules, canHaveTrouble } = input;
  const { time_jitter, mishap_penalty } = rules.race;
  const expected = raceSeconds(distance, mobility, rules);
  return {
    expected,
    best: Math.round(expected * (1 - time_jitter)),
    worst: Math.round(expected * (1 + time_jitter) * (canHaveTrouble ? 1 + mishap_penalty : 1)),
  };
}

/** The chance one ship has an engine failure on one leg of a `legCount`-leg race: the base chance of
    the race (spread over its legs) and, for a pushed engine, the engine tuning's own chance. */
export function legTroubleChance(level: number, legCount: number, rules: GameRules): number {
  const base = 1 - (1 - rules.race.mishap_chance) ** (1 / Math.max(1, legCount));
  const push = mishapChance('chem', level, 100, rules);
  return 1 - (1 - base) * (1 - push);
}

/**
 * Settles a race leg by leg, with ONE rule for every ship (the player's and the rivals'):
 *
 *   leg time = leg distance / speed x duration_k x luck x (1 + mishap_penalty per engine failure)
 *
 * `luck` is drawn per ship per leg within +-`time_jitter`; an engine failure is drawn per ship per
 * leg (the base chance of the race, plus the engine tuning's chance for a pushed ship). A rival's
 * speed and engine level are fixed for the whole race; the player's tuning is fixed for the run.
 * The player's real push failures (`playerPushLegs`, one entry per failure with its leg index) are
 * counted on the leg they happened on, on top of the same base chance every ship rolls. The order
 * is the lowest total time; a tie goes to the rival. Pure and deterministic: every draw is a
 * labelled child of `rng`, so the same seed, field and ship give the same race (the report
 * replays from the stored log).
 */
export function resolveRace(input: {
  readonly competitors: readonly RaceCompetitor[];
  readonly playerMobility: number;
  /** The distance of each leg, in order. */
  readonly legDistances: readonly number[];
  readonly rules: GameRules;
  readonly rng: Rng;
  /** Leg indices where the player's pushed engines failed (a leg appears once per failure). */
  readonly playerPushLegs?: readonly number[];
}): RaceResult {
  const { playerMobility, legDistances, rules, rng, playerPushLegs = [] } = input;
  const legCount = Math.max(1, legDistances.length);
  const field = fieldFor(input.competitors, playerMobility, rules);
  const { time_jitter, mishap_penalty } = rules.race;

  interface Runner {
    readonly name: string;
    readonly id: string;
    readonly mobility: number;
    readonly speed: number;
    readonly level: number;
    readonly you: boolean;
  }
  const runners: Runner[] = [
    ...field.map((rival) => {
      const level = Math.max(1, rival.level ?? 1);
      return {
        name: rival.name,
        id: rival.id,
        mobility: rival.mobility,
        speed: rival.mobility * level,
        level,
        you: false,
      };
    }),
    {
      name: '',
      id: 'player',
      mobility: playerMobility,
      speed: playerMobility,
      level: 1,
      you: true,
    },
  ];

  const totals = new Map<string, number>(runners.map((runner) => [runner.id, 0]));
  const pushed = new Set<string>();
  const hadTrouble = new Set<string>();
  const legs: { standings: RaceLegStanding[] }[] = [];
  legDistances.forEach((distance, index) => {
    const row: RaceLegStanding[] = runners.map((runner) => {
      const label = `${runner.id}|leg${index}`;
      const luck = 1 + rng.child(`${label}|luck`).uniform(-time_jitter, time_jitter);
      // The player's tuning failures are real events on the leg; every ship also rolls the same
      // per-leg trouble chance (the player's level-1 base chance included).
      const rolled =
        rng.child(`${label}|trouble`).float() < legTroubleChance(runner.level, legCount, rules)
          ? 1
          : 0;
      const real = runner.you ? playerPushLegs.filter((leg) => leg === index).length : 0;
      const failures = rolled + real;
      const seconds = Math.round(
        raceSeconds(distance, runner.speed, rules) * luck * (1 + mishap_penalty * failures),
      );
      const total = (totals.get(runner.id) ?? 0) + seconds;
      totals.set(runner.id, total);
      if (failures > 0) hadTrouble.add(runner.id);
      if (real > 0) pushed.add(runner.id);
      return {
        name: runner.name,
        you: runner.you,
        legSeconds: seconds,
        totalSeconds: total,
        trouble: failures > 0,
      };
    });
    legs.push({ standings: orderOf(row) });
  });

  const standings: RaceStanding[] = orderOf(
    runners.map((runner) => ({
      runner,
      totalSeconds: totals.get(runner.id) ?? 0,
      you: runner.you,
    })),
  ).map(({ runner, totalSeconds, you }) => ({
    name: runner.name,
    mobility: runner.mobility,
    seconds: totalSeconds,
    you,
    ...(pushed.has(runner.id)
      ? { trouble: 'overheat' as const }
      : hadTrouble.has(runner.id)
        ? { trouble: 'mishap' as const }
        : {}),
  }));
  const place = standings.findIndex((standing) => standing.you) + 1;
  const { prize_share_1, prize_share_2, prize_share_3 } = rules.race;
  const prizeShare =
    place === 1
      ? prize_share_1
      : place === SECOND_PLACE
        ? prize_share_2
        : place === THIRD_PLACE
          ? prize_share_3
          : 0;
  return { legs, standings, place, prizeShare };
}

/** Fastest first; a tie goes to the rival. */
function orderOf<T extends { readonly totalSeconds: number; readonly you: boolean }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => a.totalSeconds - b.totalSeconds || Number(a.you) - Number(b.you));
}
