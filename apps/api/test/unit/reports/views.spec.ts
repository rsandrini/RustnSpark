import { describe, expect, it } from '@jest/globals';
import { SUPPORTED_LOCALES, type Locale } from '../../../src/common/locale/locale.js';
import { parseMissionLogEvents } from '../../../src/reports/events/event.schema.js';
import { renderReport } from '../../../src/reports/report.render.js';
import { type ReportLog, type ViewName } from '../../../src/reports/report.types.js';
import { renderLog } from '../../../src/reports/log.view.js';
import { renderNarrative } from '../../../src/reports/narrative.view.js';
import { SUMMARY_LINE_COUNT, renderSummary } from '../../../src/reports/summary.view.js';
import {
  loadViewChrome,
  renderEventLine,
  substituteTokens,
} from '../../../src/reports/templates/template.engine.js';

/**
 * S9.3 acceptance tests for the three views:
 * - summary: fixed line count, outcome (+D37 balance) first, then events by
 *   category priority, |magnitude| within it, stored-index tie-break;
 * - log: `[leg · category] description — effect`, display-sorted while the
 *   variant seed keeps using the STORED index (provable on seed `report-1`);
 * - narrative: chapters per leg, stored order, v2 cascades as `detail`,
 *   v1 logs render without detail;
 * - purity: same inputs → byte-identical output, D39 text = concat of
 *   segments, no residual placeholders.
 */

const SEED = 'report-1';

const NAMES = {
  parts: { 'part-instance-1': { partType: 'engine_chem_small', name: 'Small Chemical Engine' } },
  materials: { common_ore: 'Common Ore' },
};

const ACTORS = { playerShipId: 'own-ship-1', clientShipId: 'client-ship-2' };

const RAW_EVENTS: Record<string, unknown>[] = [
  {
    leg: 0,
    category: 'transit',
    type: 'leg_travel',
    actors: ACTORS,
    effects: { hp: 0, condByPart: {}, credits: 0, loot: [] },
    magnitude: 742,
  },
  {
    leg: 0,
    category: 'combat',
    type: 'combat_win',
    actors: ACTORS,
    effects: { hp: -12, condByPart: {}, credits: 754, loot: [] },
    magnitude: 26,
    cascade: { shield: 18, armor: 9, hp: 4 },
  },
  {
    leg: 1,
    category: 'failure',
    type: 'tank',
    actors: ACTORS,
    effects: { hp: 0, condByPart: { 'part-instance-1': 7 }, credits: 0, loot: [] },
    magnitude: 26,
    consequence: 'fuel_leak',
    fuelLost: 12,
  },
  {
    leg: 1,
    category: 'loot',
    type: 'mining',
    actors: ACTORS,
    effects: {
      hp: 0,
      condByPart: {},
      credits: 0,
      loot: [{ materialId: 'common_ore', quantity: 3 }],
    },
    magnitude: 3,
  },
  {
    leg: 1,
    category: 'environment',
    type: 'mission_wear',
    actors: ACTORS,
    effects: { hp: 0, condByPart: {}, credits: 0, loot: [] },
    magnitude: 13,
  },
  {
    leg: 2,
    category: 'payment',
    type: 'mission_payout',
    actors: ACTORS,
    effects: { hp: 0, condByPart: {}, credits: 200, loot: [] },
    magnitude: 13,
  },
];

const LOG: ReportLog = {
  missionId: 'm-report-1',
  seed: SEED,
  schemaVersion: 2,
  outcome: 'success',
  events: parseMissionLogEvents(2, RAW_EVENTS),
  legs: [
    { index: 0, status: 'completed' },
    { index: 1, status: 'adrift' },
    { index: 2, status: 'completed' },
  ],
  partTypeById: { 'part-instance-1': 'engine_chem_small' },
  hasShield: true,
  partsBefore: [{ id: 'part-instance-1', partType: 'engine_chem_small', condition: 80 }],
  credits: 994,
  balanceAfter: 1500,
};

function desc(index: number, locale: Locale = 'en'): string {
  return renderEventLine(LOG.events[index]!, index, SEED, locale, NAMES).text;
}

function expectD39(
  lines: readonly { text: string; segments: readonly { value: string }[] }[],
): void {
  for (const line of lines) {
    expect(line.text).toBe(line.segments.map((segment) => segment.value).join(''));
    expect(line.text).not.toMatch(/\{[a-zA-Z]+\}/);
  }
}

describe('S9.3 — summary view', () => {
  it('renders SUMMARY_LINE_COUNT lines: outcome first, then the two biggest events', () => {
    const lines = renderSummary(LOG, 'en', NAMES);
    expect(SUMMARY_LINE_COUNT).toBe(3);
    expect(lines).toHaveLength(SUMMARY_LINE_COUNT);
    expect(lines[0]!.text).toBe('Mission accomplished — balance 1500 ¢');
    // Category first: the tank failure (idx 2) outranks the combat_win (idx 1),
    // and the |742| leg_travel never crowds either of them out.
    expect(lines[1]!.text).toBe(desc(2));
    expect(lines[2]!.text).toBe(desc(1));
    expectD39(lines);
  });

  it('never lets transit distance crowd combat, failures or payments out', () => {
    const transitOnly = (index: number): Record<string, unknown> => ({
      leg: index,
      category: 'transit',
      type: 'leg_travel',
      actors: ACTORS,
      effects: { hp: 0, condByPart: {}, credits: 0, loot: [] },
      magnitude: 1100,
    });
    const events = parseMissionLogEvents(2, [
      transitOnly(0),
      transitOnly(1),
      RAW_EVENTS[5]!, // mission_payout (payment)
    ]);
    const lines = renderSummary({ ...LOG, events }, 'en', NAMES);
    // outcome, then the payout (payment) ahead of both 1100-unit routes.
    expect(lines[1]!.text).toBe(renderEventLine(events[2]!, 2, SEED, 'en', NAMES).text);
  });

  it('localizes the outcome line (pt-BR)', () => {
    const lines = renderSummary(LOG, 'pt-BR', NAMES);
    expect(lines[0]!.text).toBe('Missão cumprida — saldo 1500 ¢');
    expect(lines[0]!.text).toContain('1500');
  });

  it('falls back to the balance-free result line when D37 balanceAfter is absent', () => {
    const withoutBalance = { ...LOG, balanceAfter: undefined } satisfies ReportLog;
    const lines = renderSummary(withoutBalance, 'en', NAMES);
    expect(lines[0]!.text).toBe('Mission accomplished');
    expect(lines[0]!.text).not.toContain('balance');
    expect(lines).toHaveLength(SUMMARY_LINE_COUNT);
  });

  it('is pure: two renders are byte-identical', () => {
    expect(renderSummary(LOG, 'en', NAMES)).toEqual(renderSummary(LOG, 'en', NAMES));
    expect(renderSummary(LOG, 'pt-BR', NAMES)).toEqual(renderSummary(LOG, 'pt-BR', NAMES));
  });
});

describe('S9.3 — log view', () => {
  it('renders one line per event, display-sorted by leg then category', () => {
    const lines = renderLog(LOG, 'en', NAMES);
    expect(lines).toHaveLength(RAW_EVENTS.length);
    expect(lines.map((line) => line.text)).toEqual([
      `[1 · transit] ${desc(0)} — route 742`,
      `[1 · combat] ${desc(1)} — +754 ¢`,
      `[2 · failure] ${desc(2)} — condition 7`,
      `[2 · environment] ${desc(4)} — -13 condition`,
      // Stored order was [tank, mining, wear]; display moves mining (stored
      // idx 3, shown 5th) AFTER wear — and its description must still be the
      // render of stored index 3, not display index 4 (variants differ for
      // this seed, so a display-index bug fails this equality).
      `[2 · loot] ${desc(3)} — +3 × Common Ore`,
      `[3 · payment] ${desc(5)} — +200 ¢`,
    ]);
  });

  it('keeps a ref segment for the loot effect (D38/D39)', () => {
    const miningLine = renderLog(LOG, 'en', NAMES).find((line) => line.text.includes('Common Ore'));
    expect(miningLine?.segments).toContainEqual({
      t: 'ref',
      kind: 'loot',
      id: 'common_ore',
      value: 'Common Ore',
    });
  });

  it('localizes categories and effects (pt-BR)', () => {
    const lines = renderLog(LOG, 'pt-BR', NAMES);
    expect(lines[0]!.text).toBe(`[1 · trânsito] ${desc(0, 'pt-BR')} — rota 742`);
    expect(lines[2]!.text).toBe(`[2 · falha] ${desc(2, 'pt-BR')} — condição 7`);
    expect(lines[3]!.text).toBe(`[2 · ambiente] ${desc(4, 'pt-BR')} — -13 condição`);
    expectD39(lines);
  });

  it('is pure: two renders are byte-identical', () => {
    expect(renderLog(LOG, 'en', NAMES)).toEqual(renderLog(LOG, 'en', NAMES));
  });
});

describe('S9.3 — narrative view', () => {
  it('chapters by leg with localized headers, events in stored order', () => {
    const chapters = renderNarrative(LOG, 'en', NAMES);
    expect(chapters.map((chapter) => chapter.leg)).toEqual([0, 1, 2]);
    expect(chapters.map((chapter) => chapter.header.text)).toEqual([
      'Leg 1 — completed',
      'Leg 2 — adrift',
      'Leg 3 — completed',
    ]);
    expect(chapters[0]!.lines.map((line) => line.text)).toEqual([desc(0), desc(1)]);
    expect(chapters[1]!.lines.map((line) => line.text)).toEqual([desc(2), desc(3), desc(4)]);
    expect(chapters[2]!.lines.map((line) => line.text)).toEqual([desc(5)]);
    for (const chapter of chapters) expectD39(chapter.lines);
  });

  it('carries the v2 cascade as detail on combat lines only', () => {
    const chapters = renderNarrative(LOG, 'en', NAMES);
    const combat = chapters[0]!.lines[1]!;
    expect(combat.detail?.cascade).toEqual({ shield: 18, armor: 9, hp: 4 });
    expect('detail' in chapters[0]!.lines[0]!).toBe(false);
    expect('detail' in chapters[1]!.lines[0]!).toBe(false);
  });

  it('localizes headers (pt-BR)', () => {
    const chapters = renderNarrative(LOG, 'pt-BR', NAMES);
    expect(chapters.map((chapter) => chapter.header.text)).toEqual([
      'Perna 1 — concluída',
      'Perna 2 — à deriva',
      'Perna 3 — concluída',
    ]);
    expect(chapters[0]!.lines[0]!.text).toBe(desc(0, 'pt-BR'));
  });

  it('renders a v1 log without detail (the enrichment lives only in v2)', () => {
    const v1Events = parseMissionLogEvents(1, [RAW_EVENTS[0]!, RAW_EVENTS[1]!]);
    const v1Log: ReportLog = {
      ...LOG,
      schemaVersion: 1,
      events: v1Events,
      legs: [{ index: 0, status: 'completed' }],
    };
    const chapters = renderNarrative(v1Log, 'en', NAMES);
    expect(chapters).toHaveLength(1);
    for (const line of chapters[0]!.lines) expect('detail' in line).toBe(false);
  });

  it('is pure: two renders are byte-identical', () => {
    expect(renderNarrative(LOG, 'en', NAMES)).toEqual(renderNarrative(LOG, 'en', NAMES));
  });
});

describe('S9.3 — render dispatch', () => {
  it('returns lines for summary/log and chapters for narrative', () => {
    const summary = renderReport(LOG, 'en', 'summary' satisfies ViewName, NAMES);
    const log = renderReport(LOG, 'en', 'log' satisfies ViewName, NAMES);
    const narrative = renderReport(LOG, 'en', 'narrative' satisfies ViewName, NAMES);
    expect(summary.view).toBe('summary');
    expect(log.view).toBe('log');
    expect(narrative.view).toBe('narrative');
    if (narrative.view === 'narrative') expect(narrative.chapters).toHaveLength(3);
    if (summary.view === 'summary') expect(summary.lines).toHaveLength(SUMMARY_LINE_COUNT);
  });
});

describe('S9.3 — view chrome', () => {
  it('pairs every view.json key across locales', () => {
    const keys = (value: unknown, prefix = ''): string[] => {
      if (typeof value !== 'object' || value === null) return [prefix];
      return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        keys(child, prefix ? `${prefix}.${key}` : key),
      );
    };
    const [en, pt] = SUPPORTED_LOCALES.map((locale) => loadViewChrome(locale));
    expect(keys(pt).sort()).toEqual(keys(en).sort());
  });

  it('throws on an unknown chrome token', () => {
    expect(() => substituteTokens('balance {nope}', {})).toThrow(/unknown view placeholder/);
  });
});
