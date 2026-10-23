import type { Locale } from '../common/locale/locale.js';
import type { MissionCombatRound, MissionDamageCascade } from '../resolution/events/mission-event.js';
import type { EntityNames, ReportLine } from './templates/template.engine.js';
import {
  renderEventLine,
  renderPhaseLine,
  substituteTokens,
} from './templates/template.engine.js';
import { endPhaseOf } from './report.phases.js';
import { type ReportLog, viewChrome } from './report.types.js';

/** A narrative event line; `detail` carries the popup payload (S10.8). */
export interface NarrativeLine extends ReportLine {
  /** What kind of event this is (combat, transit, failure, environment, loot, payment). */
  readonly category: string;
  readonly type: string;
  /** Present only when the stored event carries a v2 cascade (S9.0). */
  readonly detail?: {
    readonly cascade: MissionDamageCascade;
    /** Round-4: absent on rows written before this field existed, even on v2 logs. */
    readonly rounds?: readonly MissionCombatRound[];
  };
}

export interface NarrativeChapter {
  readonly leg: number;
  readonly header: ReportLine;
  readonly lines: readonly NarrativeLine[];
}

/**
 * Narrative view (S9.3): chapters per leg, events in stored order (the seed
 * positions are the stored positions). When the log is schemaVersion 2 the
 * combat lines carry their cascade as `detail` — the popup data D39/S10.8
 * reads without parsing text.
 */
export function renderNarrative(
  log: ReportLog,
  locale: Locale,
  names: EntityNames,
): NarrativeChapter[] {
  const chrome = viewChrome(locale);
  const legIndexes = [...new Set(log.events.map((event) => event.leg))].sort((a, b) => a - b);

  const departure = renderPhaseLine('phase_departure', log.seed, locale, names);
  const endType = endPhaseOf(log);
  const arrival = renderPhaseLine(endType, log.seed, locale, names);

  return legIndexes.map((leg, position) => {
    const status = log.legs.find((entry) => entry.index === leg)?.status;
    const header = substituteTokens(chrome.chapter, {
      leg: String(leg + 1),
      status: status !== undefined ? (chrome.legStatuses[status] ?? status) : '',
    });
    const lines: NarrativeLine[] = [];
    if (position === 0 && departure !== null) {
      lines.push({ ...departure, category: 'transit', type: 'phase_departure' });
    }
    log.events.forEach((event, storedIndex) => {
      if (event.leg !== leg) return;
      const line = renderEventLine(event, storedIndex, log.seed, locale, names);
      const tagged = { ...line, category: event.category, type: event.type };
      lines.push(
        event.cascade
          ? { ...tagged, detail: { cascade: event.cascade, rounds: event.rounds } }
          : tagged,
      );
    });
    if (position === legIndexes.length - 1 && arrival !== null) {
      lines.push({ ...arrival, category: 'transit', type: endType });
    }
    return { leg, header, lines };
  });
}
