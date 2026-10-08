import type { Rng } from '../../common/rng/rng.js';
import type { GameRules } from '../../config/game-config.types.js';

/** A rival ship on a RACE mission's grid: generated with the offer, frozen in its cargo. */
export interface RaceCompetitor {
  readonly id: string;
  readonly name: string;
  /** Mobility: the same speed stat a player ship has (thrust over mass). */
  readonly mobility: number;
}

export interface RaceStanding {
  readonly name: string;
  readonly mobility: number;
  /** Finish time in seconds (before the mission time scale). */
  readonly seconds: number;
  readonly you: boolean;
}

export interface RaceResult {
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
const ROUND_FACTOR = 100;
const SECOND_PLACE = 2;
const THIRD_PLACE = 3;

function roundTo2(value: number): number {
  return Math.round(value * ROUND_FACTOR) / ROUND_FACTOR;
}

/** The rivals of one race: 3–5 (admin-tunable) ships whose speeds are drawn around the reference. */
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
    field.push({ id: `rival-${index + 1}`, name, mobility });
  }
  return field;
}

/** Finish time of a ship over `distance`: the same `distance / mobility × duration_k` the player's
    own mission duration uses, so a faster ship really does arrive earlier. */
export function raceSeconds(distance: number, mobility: number, rules: GameRules): number {
  return Math.round((distance / Math.max(mobility, MIN_MOBILITY)) * rules.missions.duration_k);
}

/**
 * Settles a race the player's ship finished. Everyone — the player included — gets the same
 * seeded luck on the day (`time_jitter`); a tie goes to the rival. Pure and deterministic: same
 * seed, field and ship give the same standings (the report replays from the stored log).
 */
export function resolveRace(input: {
  readonly competitors: readonly RaceCompetitor[];
  readonly playerMobility: number;
  readonly totalDistance: number;
  readonly rules: GameRules;
  readonly rng: Rng;
}): RaceResult {
  const { competitors, playerMobility, totalDistance, rules, rng } = input;
  const jitter = rules.race.time_jitter;
  const luck = (label: string): number => 1 + rng.child(label).uniform(-jitter, jitter);
  const standings: RaceStanding[] = [
    ...competitors.map((rival) => ({
      name: rival.name,
      mobility: rival.mobility,
      seconds: Math.round(raceSeconds(totalDistance, rival.mobility, rules) * luck(rival.id)),
      you: false,
    })),
    {
      name: '',
      mobility: playerMobility,
      seconds: Math.round(raceSeconds(totalDistance, playerMobility, rules) * luck('player')),
      you: true,
    },
  ].sort((a, b) => a.seconds - b.seconds || Number(a.you) - Number(b.you));
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
  return { standings, place, prizeShare };
}
