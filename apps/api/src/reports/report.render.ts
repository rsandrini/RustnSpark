import type { Locale } from '../common/locale/locale.js';
import type { ReportLine } from './templates/template.engine.js';
import type { EntityNames } from './templates/template.engine.js';
import { renderLog, type LogLine } from './log.view.js';
import { renderNarrative, type NarrativeChapter } from './narrative.view.js';
import type { ReportLog, ViewName } from './report.types.js';
import { renderSummary } from './summary.view.js';

export type ViewResult =
  | { readonly view: 'summary'; readonly lines: readonly ReportLine[] }
  | { readonly view: 'log'; readonly lines: readonly LogLine[] }
  | { readonly view: 'narrative'; readonly chapters: readonly NarrativeChapter[] };

/**
 * The single `(log, locale, view, names) → render` entry point (S9.3): pure —
 * same inputs, byte-identical output — and decoupled from the requesting
 * player so the Admin replay (S11) reuses it unchanged.
 */
export function renderReport(
  log: ReportLog,
  locale: Locale,
  view: ViewName,
  names: EntityNames,
): ViewResult {
  switch (view) {
    case 'summary':
      return { view, lines: renderSummary(log, locale, names) };
    case 'log':
      return { view, lines: renderLog(log, locale, names) };
    case 'narrative':
      return { view, chapters: renderNarrative(log, locale, names) };
  }
}
