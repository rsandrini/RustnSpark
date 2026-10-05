import type { Locale } from '../common/locale/locale.js';
import type { ParsedMissionEvent } from './events/event.schema.js';
import type { ReportLine, ReportSegment } from './templates/template.engine.js';
import { loadViewChrome } from './templates/template.engine.js';

export type ViewName = 'summary' | 'narrative' | 'log';

export const VIEW_NAMES: readonly ViewName[] = ['summary', 'narrative', 'log'];

/** One leg of the stored log, as the narrative chapters need it. */
export interface ReportLegRef {
  readonly index: number;
  readonly status: string;
}

/**
 * The pure input of `(log, locale, view) → lines` (S9.3): everything a render
 * needs, gathered by `ReportsService` from MissionLog + the mission.resolved
 * PlayerEvent + live catalog names — and nothing about the requesting player,
 * so the Admin replay (S11) can call the same function.
 */
export interface ReportLog {
  readonly missionId: string;
  readonly seed: string | number;
  readonly schemaVersion: number;
  readonly outcome: string;
  readonly events: readonly ParsedMissionEvent[];
  readonly legs: readonly ReportLegRef[];
  /**
   * Part instance id → catalog part type, from the mission's dispatch snapshot. Events name
   * parts by instance id; this is what lets a renderer (and the Admin replay) turn them into
   * catalog names without reading the player's current parts, which may have been sold.
   */
  readonly partTypeById: Readonly<Record<string, string>>;
  /** Wallet movement of the run (PlayerEvent.creditsDelta). */
  readonly credits: number;
  /** D37: balance after the payout; absent on pre-S9.0 PlayerEvents. */
  readonly balanceAfter?: number;
  /**
   * True when the dispatched ship had at least one shield-providing DEFENSE part (`catalog.esc >
   * 0`, the same test `failureCategory` uses). The debrief must not report "shield took 0
   * damage" for a ship that never had one to begin with.
   */
  readonly hasShield: boolean;
  /** Every installed part's condition at dispatch — the "before" half of the Details tab's table. */
  readonly partsBefore: readonly {
    readonly id: string;
    readonly partType: string;
    readonly condition: number;
  }[];
}

/** View-chrome strings for one locale (S9.3's `view.json`). */
export interface ReportViewChrome {
  readonly categories: Readonly<Record<string, string>>;
  readonly outcomes: Readonly<Record<string, string>>;
  readonly legStatuses: Readonly<Record<string, string>>;
  readonly summary: { readonly result: string; readonly resultBalance: string };
  readonly chapter: string;
  readonly effects: Readonly<
    Record<'credits' | 'damage' | 'condition' | 'wear' | 'loot' | 'distance' | 'none', string>
  >;
}

export function viewChrome(locale: Locale): ReportViewChrome {
  const data = loadViewChrome(locale) as Partial<ReportViewChrome>;
  if (
    !data.categories ||
    !data.outcomes ||
    !data.legStatuses ||
    !data.summary?.result ||
    !data.summary.resultBalance ||
    !data.chapter ||
    !data.effects?.none
  ) {
    throw new Error(`Report template ${locale}/view.json is missing required chrome keys`);
  }
  return data as ReportViewChrome;
}

/** Concatenates string/line/segment pieces into one D39 line, merging text runs. */
export function concatLine(
  ...parts: readonly (string | ReportLine | readonly ReportSegment[])[]
): ReportLine {
  const segments: ReportSegment[] = [];
  const push = (piece: string | ReportLine | readonly ReportSegment[]): void => {
    let items: readonly ReportSegment[];
    if (typeof piece === 'string') items = [{ t: 'text', value: piece }];
    else if ('segments' in piece) items = piece.segments;
    else items = piece;
    for (const item of items) {
      if (item.value === '') continue;
      const last = segments[segments.length - 1];
      if (last && last.t === 'text' && item.t === 'text') {
        segments[segments.length - 1] = { t: 'text', value: last.value + item.value };
      } else {
        segments.push(item);
      }
    }
  };
  for (const part of parts) push(part);
  return { text: segments.map((segment) => segment.value).join(''), segments };
}
