/**
 * Every number kept per pilot. The list is the schema: totals and records live in JSON bags
 * (`PlayerStats`, `PlayerStatsDaily`), so a new key needs no migration, only an entry here.
 * Dotted lowercase names, grouped by what they count.
 */
export const STAT_KEYS = [
  // flying
  'missions.started',
  'missions.success',
  'missions.failed',
  'missions.aborted',
  'missions.ship_lost',
  'flight.distance',
  'flight.legs',
  'flight.seconds',
  'fuel.burned',
  'fuel.lost',
  'rescue.called',
  'adrift.times',
  // combat
  'fights.won',
  'fights.lost',
  'fights.escaped',
  'fights.drawn',
  'fights.pirate',
  'fights.pvp',
  'damage.taken',
  'damage.taken_shield',
  'damage.taken_armor',
  'damage.taken_hull',
  'damage.dealt',
  'pirates.parts_stolen',
  // wear
  'wear.points',
  'parts.failures',
  'parts.destroyed',
  'ships.destroyed',
  // races
  'races.entered',
  'races.won',
  'races.podium',
  // field work
  'scavenge.ship_runs',
  'scavenge.foot_runs',
  'scavenge.parts_found',
  'scavenge.scrap_found',
  'mining.runs',
  'mining.ore',
  // money in
  'money.earned_missions',
  'money.earned_parts',
  'money.earned_materials',
  'money.earned_other',
  // money out
  'money.spent_parts',
  'money.spent_refuel',
  'money.spent_repair',
  'money.spent_upgrade',
  'money.spent_resize',
  'money.spent_rescue',
  'money.spent_other',
  // counts
  'parts.bought',
  'parts.sold',
  'repairs.count',
  'refuels.count',
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

/** What to add to the totals; keys left out are untouched. */
export type StatDelta = Partial<Record<StatKey, number>>;

/** Bests that a plain counter cannot give: the best (or worst) single value ever. */
export const RECORD_DIRECTION = {
  'best.payout': 'max',
  'best.run_distance': 'max',
  'best.wallet': 'max',
  'best.race_place': 'min',
  'best.race_seconds': 'min',
  'worst.run_damage': 'max',
} as const;

export const RECORD_KEYS = Object.keys(RECORD_DIRECTION) as RecordKey[];

export type RecordKey = keyof typeof RECORD_DIRECTION;

/** A stored record: the value, when it was set, and the mission it came from when there is one. */
export interface StatRecord {
  readonly value: number;
  readonly at: string;
  readonly missionId?: string;
}

export type StatTotals = Partial<Record<StatKey, number>>;
export type StatRecords = Partial<Record<RecordKey, StatRecord>>;
