import type { ReportLog } from './report.types.js';
import type { EntityNames } from './templates/template.engine.js';

/**
 * The numbers of a run, gathered from its stored events for the report's debrief header. Pure:
 * same log in, same stats out (the admin replay can call it too). Damage is summed from the
 * fight-closing events only (`combat_win` / `combat_loss`): the layer split is a fight-level triple
 * repeated on every combat event of that fight, so summing all of them would count it twice.
 */
export interface ReportStats {
  readonly credits: number;
  readonly balanceAfter: number | null;
  readonly legs: number;
  readonly distance: number;
  readonly fights: {
    readonly won: number;
    readonly lost: number;
    readonly escaped: number;
    readonly drawn: number;
    readonly pvp: number;
  };
  readonly damage: { readonly shield: number; readonly armor: number; readonly hull: number };
  /** Parts that failed (motor, battery, tank, shield, weapon, sensor). */
  readonly partFailures: number;
  readonly fuelLost: number;
  /** What pirates took: parts from storage, or the cargo / the ground (`motive`). */
  /** What a scavenging job turned up. */
  readonly found: readonly {
    readonly kind: 'part' | 'scrap';
    readonly partType: string;
    readonly name: string;
    readonly condition: number;
  }[];
  readonly pirates: { readonly stolenParts: number; readonly motive: string | null };
  readonly loot: readonly {
    readonly materialId: string;
    readonly name: string;
    readonly quantity: number;
  }[];
}

const PART_FAILURE_TYPES: ReadonlySet<string> = new Set([
  'motor',
  'battery',
  'tank',
  'shield',
  'weapon',
  'sensor',
]);

export function computeReportStats(log: ReportLog, names: EntityNames): ReportStats {
  let won = 0;
  let lost = 0;
  let escaped = 0;
  let drawn = 0;
  let pvp = 0;
  let distance = 0;
  let partFailures = 0;
  let fuelLost = 0;
  let stolenParts = 0;
  let motive: string | null = null;
  const damage = { shield: 0, armor: 0, hull: 0 };
  const loot = new Map<string, number>();
  const found: ReportStats['found'][number][] = [];

  for (const event of log.events) {
    if (event.type === 'leg_travel') distance += Math.abs(event.magnitude);
    if (event.type === 'combat_win') won += 1;
    if (event.type === 'combat_loss') lost += 1;
    if (event.type === 'escaped') escaped += 1;
    if (event.type === 'combat_draw') drawn += 1;
    if (event.type === 'pvp_encounter') pvp += 1;
    if (PART_FAILURE_TYPES.has(event.type)) partFailures += 1;
    if (event.fuelLost !== undefined) fuelLost += event.fuelLost;
    if (event.type === 'scavenge_find' && event.found !== undefined) {
      found.push({
        kind: event.found.kind,
        partType: event.found.partType,
        name: names.partTypes?.[event.found.partType] ?? event.found.partType,
        condition: event.found.condition,
      });
    }
    if (event.type === 'pirate_demand') {
      stolenParts += event.stolen?.length ?? 0;
      motive = event.motive ?? motive;
    }
    if (
      (event.type === 'combat_win' ||
        event.type === 'combat_loss' ||
        event.type === 'combat_draw') &&
      event.cascade
    ) {
      damage.shield += event.cascade.shield;
      damage.armor += event.cascade.armor;
      damage.hull += event.cascade.hp;
    }
    for (const entry of event.effects.loot) {
      loot.set(entry.materialId, (loot.get(entry.materialId) ?? 0) + entry.quantity);
    }
  }

  return {
    // The wallet moves whole credits; a replay carries the engine's raw figure, so round for both.
    credits: Math.round(log.credits),
    balanceAfter: log.balanceAfter ?? null,
    legs: log.legs.length,
    distance,
    fights: { won, lost, escaped, drawn, pvp },
    damage,
    partFailures,
    fuelLost,
    found,
    pirates: { stolenParts, motive },
    loot: [...loot.entries()]
      .filter(([, quantity]) => quantity > 0)
      .map(([materialId, quantity]) => ({
        materialId,
        name: names.materials[materialId] ?? materialId,
        quantity,
      })),
  };
}
