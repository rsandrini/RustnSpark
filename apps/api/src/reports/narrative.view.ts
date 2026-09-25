import type { Locale } from '../common/locale/locale.js';
import type { MissionDamageCascade } from '../resolution/events/mission-event.js';
import type { EntityNames, ReportLine } from './templates/template.engine.js';
import { renderEventLine, substituteTokens } from './templates/template.engine.js';
import { type ReportLog, viewChrome } from './report.types.js';

/** A narrative event line; `detail` carries the popup payload (S10.8). */
export interface NarrativeLine extends ReportLine {
  /** Present only when the stored event carries a v2 cascade (S9.0). */
  readonly detail?: { readonly cascade: MissionDamageCascade };
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

  return legIndexes.map((leg) => {
    const status = log.legs.find((entry) => entry.index === leg)?.status;
    const header = substituteTokens(chrome.chapter, {
      leg: String(leg + 1),
      status: status !== undefined ? (chrome.legStatuses[status] ?? status) : '',
    });
    const lines: NarrativeLine[] = [];
    log.events.forEach((event, storedIndex) => {
      if (event.leg !== leg) return;
      const line = renderEventLine(event, storedIndex, log.seed, locale, names);
      lines.push(
        event.cascade ? { ...line, detail: { cascade: event.cascade } } : line,
      );
    });
    return { leg, header, lines };
  });
}
