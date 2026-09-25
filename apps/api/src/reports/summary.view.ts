import type { Locale } from '../common/locale/locale.js';
import type { EntityNames, ReportLine } from './templates/template.engine.js';
import {
  formatNumber,
  renderEventLine,
  substituteTokens,
} from './templates/template.engine.js';
import { type ReportLog, viewChrome } from './report.types.js';

/**
 * Summary view (S9.3): 2–3 lines the player skims every time — the outcome
 * (with the D37 balance when available) plus the events that mattered most.
 * The line count is presentation, never balance: SUMMARY_LINE_COUNT is the
 * named constant that fixes how many lines exist.
 *
 * Ranking is by category first, then magnitude: magnitudes are in different
 * units per type (route distance on `leg_travel`, credits on payments, condition
 * points on failures), so comparing them across categories let a 700-unit route
 * push every fight and failure out of the summary. Within one category the units
 * agree, so the biggest event wins; ties fall to the stored position.
 */
export const SUMMARY_LINE_COUNT = 3;

const SUMMARY_CATEGORY_PRIORITY = [
  'failure',
  'combat',
  'payment',
  'loot',
  'environment',
  'transit',
] as const;

function categoryRank(category: string): number {
  const index = (SUMMARY_CATEGORY_PRIORITY as readonly string[]).indexOf(category);
  return index === -1 ? SUMMARY_CATEGORY_PRIORITY.length : index;
}

export function renderSummary(
  log: ReportLog,
  locale: Locale,
  names: EntityNames,
): ReportLine[] {
  const chrome = viewChrome(locale);
  const outcome = chrome.outcomes[log.outcome] ?? log.outcome;
  const resultLine =
    log.balanceAfter !== undefined
      ? substituteTokens(chrome.summary.resultBalance, {
          outcome,
          balance: formatNumber(log.balanceAfter, locale),
        })
      : substituteTokens(chrome.summary.result, { outcome });

  const topEventCount = SUMMARY_LINE_COUNT - 1;
  const ranked = log.events
    .map((event, storedIndex) => ({ event, storedIndex }))
    .sort(
      (a, b) =>
        categoryRank(a.event.category) - categoryRank(b.event.category) ||
        Math.abs(b.event.magnitude) - Math.abs(a.event.magnitude) ||
        a.storedIndex - b.storedIndex,
    )
    .slice(0, topEventCount);

  return [
    resultLine,
    ...ranked.map(({ event, storedIndex }) =>
      renderEventLine(event, storedIndex, log.seed, locale, names),
    ),
  ];
}
