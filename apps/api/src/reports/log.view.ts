import type { Locale } from '../common/locale/locale.js';
import type { ParsedMissionEvent } from './events/event.schema.js';
import type { EntityNames, ReportLine, ReportSegment } from './templates/template.engine.js';
import {
  firstCondition,
  formatNumber,
  formatSigned,
  renderEventLine,
  renderPhaseLine,
  substituteTokens,
  type PhaseType,
} from './templates/template.engine.js';
import { endPhaseOf } from './report.phases.js';
import { concatLine, type ReportLog, viewChrome } from './report.types.js';

/**
 * Log view (S9.3): one line per event as `[leg · category] description —
 * effect`, sorted for display by leg then category. Seeds always use the
 * STORED array position — the display sort never feeds back into variant
 * choice (S9.2).
 */
const CATEGORY_ORDER = ['transit', 'combat', 'failure', 'environment', 'loot', 'payment'] as const;

const PART_FAILURE_TYPES = new Set(['motor', 'engine_push', 'battery', 'tank', 'shield', 'weapon', 'sensor']);

type EffectKey = 'credits' | 'damage' | 'condition' | 'wear' | 'loot' | 'distance' | 'none';

function effectFor(
  event: ParsedMissionEvent,
  locale: Locale,
  names: EntityNames,
): { key: EffectKey; values: Record<string, string | ReportSegment> } {
  const { credits, hp, loot } = event.effects;
  if (credits !== 0) return { key: 'credits', values: { value: formatSigned(credits, locale) } };
  const entry = loot[0];
  if (entry) {
    return {
      key: 'loot',
      values: {
        value: formatNumber(entry.quantity, locale),
        name: {
          t: 'ref',
          kind: 'loot',
          id: entry.materialId,
          value: names.materials[entry.materialId] ?? entry.materialId,
        },
      },
    };
  }
  if (hp !== 0) {
    return { key: 'damage', values: { value: formatNumber(Math.abs(hp), locale) } };
  }
  if (PART_FAILURE_TYPES.has(event.type)) {
    return { key: 'condition', values: { value: firstCondition(event, locale) } };
  }
  if (event.type === 'mission_wear') {
    return { key: 'wear', values: { value: formatNumber(event.magnitude, locale) } };
  }
  if (event.type === 'leg_travel') {
    return { key: 'distance', values: { value: formatNumber(event.magnitude, locale) } };
  }
  return { key: 'none', values: {} };
}

/** One row of the log: the line as before plus its parts, so a screen can lay it out as a table. */
export interface LogLine extends ReportLine {
  readonly leg: number;
  readonly category: string;
  readonly categoryLabel: string;
  readonly type: string;
  readonly description: ReportLine;
  readonly effect: ReportLine;
}

export function renderLog(log: ReportLog, locale: Locale, names: EntityNames): LogLine[] {
  const chrome = viewChrome(locale);

  const ranked = log.events
    .map((event, storedIndex) => ({ event, storedIndex }))
    .sort((a, b) => {
      if (a.event.leg !== b.event.leg) return a.event.leg - b.event.leg;
      const ac = CATEGORY_ORDER.indexOf(a.event.category);
      const bc = CATEGORY_ORDER.indexOf(b.event.category);
      return (ac === -1 ? CATEGORY_ORDER.length : ac) - (bc === -1 ? CATEGORY_ORDER.length : bc);
    });

  const phaseRow = (type: PhaseType, leg: number): LogLine | null => {
    const description = renderPhaseLine(type, log.seed, locale, names);
    if (description === null) return null;
    const category = chrome.categories['transit'] ?? 'transit';
    const effect = substituteTokens(chrome.effects.none, {});
    return {
      ...concatLine(`[${leg + 1} · ${category}] `, description, ' — ', effect),
      leg,
      category: 'transit',
      categoryLabel: category,
      type,
      description,
      effect,
    };
  };
  const firstLeg = ranked[0]?.event.leg ?? 0;
  const lastLeg = ranked.at(-1)?.event.leg ?? 0;
  const departure = ranked.length === 0 ? null : phaseRow('phase_departure', firstLeg);
  const arrival = ranked.length === 0 ? null : phaseRow(endPhaseOf(log), lastLeg);

  const rows = ranked.map(({ event, storedIndex }) => {
    const category = chrome.categories[event.category] ?? event.category;
    const prefix = `[${event.leg + 1} · ${category}] `;
    const description = renderEventLine(event, storedIndex, log.seed, locale, names);
    const { key, values } = effectFor(event, locale, names);
    const effect = substituteTokens(chrome.effects[key], values);
    return {
      ...concatLine(prefix, description, ' — ', effect),
      leg: event.leg,
      category: event.category,
      categoryLabel: category,
      type: event.type,
      description,
      effect,
    };
  });
  return [...(departure === null ? [] : [departure]), ...rows, ...(arrival === null ? [] : [arrival])];
}
