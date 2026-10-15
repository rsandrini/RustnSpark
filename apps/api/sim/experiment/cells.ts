/**
 * The experiment matrix (plan Phase 4.3): one cell = one way of playing. The default is the
 * three deliberate temperaments across the three playstyles, plus the random pilot as the
 * control — ten cells, comparable run by run on the same seeds.
 */
import { DEFAULT_HOURS_PER_DAY } from '../core/clock.js';
import type { Temperament } from '../bots/temperament.js';
import type { Playstyle } from '../bots/playstyle.js';
import type { Archetype } from '../bots/archetype.js';

export interface ExperimentCell {
  readonly temperament: Temperament;
  readonly playstyle: Playstyle;
  readonly archetype: Archetype;
  readonly hoursPerDay: number;
  readonly settingsName: string;
}

/**
 * Matches the `runs.cell` column in the store: `temperament|playstyle|hoursPerDayh`, with
 * `|archetype` appended for any build other than the legacy `chem` kit.
 */
export function cellName(cell: ExperimentCell): string {
  const tail = cell.archetype === 'chem' ? '' : `|${cell.archetype}`;
  return `${cell.temperament}|${cell.playstyle}|${cell.hoursPerDay}h${tail}`;
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
      cells.push({ temperament, playstyle, archetype: 'chem', hoursPerDay, settingsName });
    }
  }
  cells.push({
    temperament: 'random',
    playstyle: 'generalist',
    archetype: 'chem',
    hoursPerDay,
    settingsName,
  });
  return cells;
}

const ARCHETYPES: readonly Archetype[] = ['chem', 'chem-shield', 'ion-shield', 'hybrid'];

/** Every archetype × the three deliberate temperaments (generalist), plus random per archetype. */
export function archetypeMatrix(
  hoursPerDay: number = DEFAULT_HOURS_PER_DAY,
  settingsName = 'default',
): readonly ExperimentCell[] {
  const cells: ExperimentCell[] = [];
  for (const archetype of ARCHETYPES) {
    for (const temperament of [...DELIBERATE_TEMPERAMENTS, 'random' as const]) {
      cells.push({ temperament, playstyle: 'generalist', archetype, hoursPerDay, settingsName });
    }
  }
  return cells;
}
