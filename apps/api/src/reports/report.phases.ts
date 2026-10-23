import type { PhaseType } from './templates/template.engine.js';
import type { ReportLog } from './report.types.js';

/** How the mission ended, as a phase: arrived, gave up on the way, or adrift. */
export function endPhaseOf(log: ReportLog): Exclude<PhaseType, 'phase_departure'> {
  if (log.outcome === 'adrift') return 'phase_adrift';
  const last = [...log.legs].sort((a, b) => a.index - b.index).at(-1);
  return last?.status === 'completed' ? 'phase_arrival' : 'phase_aborted';
}
