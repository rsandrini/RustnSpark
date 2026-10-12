/**
 * The experiment matrix (plan Phase 4.3): one cell = one way of playing. The default is the
 * three deliberate temperaments across the three playstyles, plus the random pilot as the
 * control — ten cells, comparable run by run on the same seeds.
 */
import { DEFAULT_HOURS_PER_DAY } from '../core/clock.js';
import type { Temperament } from '../bots/temperament.js';
import type { Playstyle } from '../bots/playstyle.js';

export interface ExperimentCell {
  readonly temperament: Temperament;
  readonly playstyle: Playstyle;
  readonly hoursPerDay: number;
  readonly settingsName: string;
}

/** Matches the `runs.cell` column in the store: `temperament|playstyle|hoursPerDayh`. */
export function cellName(cell: ExperimentCell): string {
  return `${cell.temperament}|${cell.playstyle}|${cell.hoursPerDay}h`;
}

const DELIBERATE_TEMPERAMENTS: readonly Temperament[] = ['greedy', 'balanced', 'safe'];
const PLAYSTYLES: readonly Playstyle[] = ['generalist', 'hauler', 'rescuer'];

/** 3 temperaments × 3 playstyles, plus the random generalist as the tenth cell. */
export function defaultMatrix(
  hoursPerDay: number = DEFAULT_HOURS_PER_DAY,
  settingsName = 'default',
): readonly ExperimentCell[] {
  const cells: ExperimentCell[] = [];
  for (const temperament of DELIBERATE_TEMPERAMENTS) {
    for (const playstyle of PLAYSTYLES) {
      cells.push({ temperament, playstyle, hoursPerDay, settingsName });
    }
  }
  cells.push({ temperament: 'random', playstyle: 'generalist', hoursPerDay, settingsName });
  return cells;
}
