import type { MissionEvent } from '../resolution/events/mission-event.js';
import type { MissionStatus } from '../resolution/mission/mission.resolver.js';
import type { RecordKey, StatDelta } from './stat-keys.js';

const PODIUM_PLACES = 3;
const FAILURE_TYPES: ReadonlySet<string> = new Set([
  'motor',
  'engine_push',
  'battery',
  'tank',
  'shield',
  'weapon',
  'sensor',
]);

export interface RunStatsInput {
  /** MissionType of the mission (`SCAVENGE`, `MINING`, `RACE`, ...). */
  readonly type: string;
  readonly status: MissionStatus;
  readonly events: readonly MissionEvent[];
  /** Each part's condition when the ship left port. */
  readonly partsBefore: readonly { readonly id: string; readonly condition: number }[];
  /** Each part's condition when the run ended. */
  readonly partsAfter: readonly { readonly id: string; readonly condition: number }[];
  readonly fuelBefore: number;
  readonly fuelAfter: number;
  /** Credits the wallet moved for this mission (negative for a penalty). */
  readonly credited: number;
  readonly shipLost: boolean;
  readonly onFoot: boolean;
  /** True for a part whose condition counts as destroyed (the rules' dead threshold). */
  readonly isDead: (condition: number) => boolean;
}

export interface RunStats {
  readonly delta: StatDelta;
  readonly records: readonly { readonly key: RecordKey; readonly value: number }[];
  /** The pilot's finishing place and displayed time when the run was a race; null otherwise. */
  readonly race: { readonly place: number; readonly seconds: number } | null;
}

/**
 * The numbers one resolved mission adds to the pilot's stats, read from its stored events. Pure:
 * the same run gives the same numbers, so the admin replay could call it too. Damage is summed
 * from the fight-closing events only: the layer split and the rounds are a fight-level value
 * repeated on every combat event of that fight, so summing all of them would count it twice.
 */
export function runStatsOf(input: RunStatsInput): RunStats {
  const totals: Record<string, number> = {};
  const add = (key: string, amount: number) => {
    if (amount !== 0) totals[key] = (totals[key] ?? 0) + amount;
  };

  let fuelLost = 0;
  let wearPoints = 0;
  const damage = { shield: 0, armor: 0, hull: 0 };
  let dealt = 0;
  let ore = 0;
  const current = new Map(input.partsBefore.map((part) => [part.id, part.condition]));
  let racePlace: number | null = null;
  let raceSeconds: number | null = null;

  for (const event of input.events) {
    if (event.type === 'leg_travel') {
      add('flight.distance', Math.abs(event.magnitude));
      add('flight.legs', 1);
    }
    if (event.type === 'combat_win') add('fights.won', 1);
    if (event.type === 'combat_loss') add('fights.lost', 1);
    if (event.type === 'combat_draw') add('fights.drawn', 1);
    if (event.type === 'escaped') add('fights.escaped', 1);
    if (
      event.type === 'combat_win' ||
      event.type === 'combat_loss' ||
      event.type === 'combat_draw' ||
      event.type === 'escaped'
    ) {
      add('fights.pirate', 1);
    }
    if (event.type === 'pvp_encounter') {
      add('fights.pvp', 1);
    }
    if (
      event.type === 'combat_win' ||
      event.type === 'combat_loss' ||
      event.type === 'combat_draw'
    ) {
      if (event.cascade !== undefined) {
        damage.shield += event.cascade.shield;
        damage.armor += event.cascade.armor;
        damage.hull += event.cascade.hp;
      }
      for (const round of event.rounds ?? []) {
        if (round.attacker === 'player' && round.hit) dealt += round.damage;
      }
    }
    if (FAILURE_TYPES.has(event.type)) add('parts.failures', 1);
    if (event.fuelLost !== undefined) fuelLost += event.fuelLost;
    if (event.type === 'pirate_demand') add('pirates.parts_stolen', event.stolen?.length ?? 0);
    if (event.type === 'scavenge_find' && event.found !== undefined) {
      add(event.found.kind === 'part' ? 'scavenge.parts_found' : 'scavenge.scrap_found', 1);
    }
    if (input.type === 'MINING') {
      for (const entry of event.effects.loot) ore += entry.quantity;
    }
    if (event.type === 'race_result' && event.race !== undefined) {
      racePlace = event.race.place;
      const you = event.race.standings.find((standing) => standing.you);
      if (you !== undefined) raceSeconds = Math.round(you.seconds * event.race.timeScale);
    }
    for (const [partId, condition] of Object.entries(event.effects.condByPart)) {
      if (event.type === 'mission_wear') {
        const lost = (current.get(partId) ?? condition) - condition;
        if (lost > 0) wearPoints += lost;
      }
      current.set(partId, condition);
    }
  }

  add('missions.started', 1);
  if (input.status === 'success') add('missions.success', 1);
  else if (input.status === 'adrift') add('missions.aborted', 1);
  else add('missions.failed', 1);
  if (input.status === 'adrift') add('adrift.times', 1);
  if (input.shipLost) {
    add('missions.ship_lost', 1);
    add('ships.destroyed', 1);
  }

  const damageTotal = damage.shield + damage.armor + damage.hull;
  add('damage.taken', damageTotal);
  add('damage.taken_shield', damage.shield);
  add('damage.taken_armor', damage.armor);
  add('damage.taken_hull', damage.hull);
  add('damage.dealt', dealt);
  add('fuel.lost', fuelLost);
  add('fuel.burned', Math.max(0, Math.round(input.fuelBefore - input.fuelAfter - fuelLost)));
  add('wear.points', wearPoints);
  add('mining.ore', ore);

  const destroyed = input.partsAfter.filter(
    (part) =>
      input.isDead(part.condition) &&
      !input.isDead(input.partsBefore.find((before) => before.id === part.id)?.condition ?? 0),
  ).length;
  add('parts.destroyed', destroyed);

  if (input.type === 'SCAVENGE') add(input.onFoot ? 'scavenge.foot_runs' : 'scavenge.ship_runs', 1);
  if (input.type === 'MINING') add('mining.runs', 1);
  if (racePlace !== null) {
    add('races.entered', 1);
    if (racePlace === 1) add('races.won', 1);
    if (racePlace <= PODIUM_PLACES) add('races.podium', 1);
  }

  const records: { key: RecordKey; value: number }[] = [];
  if (input.credited > 0) records.push({ key: 'best.payout', value: input.credited });
  if (totals['flight.distance'] !== undefined) {
    records.push({ key: 'best.run_distance', value: totals['flight.distance'] });
  }
  if (damageTotal > 0) records.push({ key: 'worst.run_damage', value: damageTotal });
  if (racePlace !== null) records.push({ key: 'best.race_place', value: racePlace });
  if (raceSeconds !== null) records.push({ key: 'best.race_seconds', value: raceSeconds });

  return {
    delta: totals,
    records,
    race:
      racePlace !== null && raceSeconds !== null
        ? { place: racePlace, seconds: raceSeconds }
        : null,
  };
}
