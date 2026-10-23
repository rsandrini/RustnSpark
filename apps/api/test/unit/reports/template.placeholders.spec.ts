import { describe, expect, it } from '@jest/globals';
import { reportTemplateSeed } from '../../../prisma/seed-data/report-templates.js';
import {
  PHASE_TYPES,
  TEMPLATE_PLACEHOLDERS,
  templateProblems,
} from '../../../src/reports/templates/template.placeholders.js';
import {
  loadLegacyVariants,
  loadTemplateVariants,
  setTemplateOverrides,
} from '../../../src/reports/templates/template.engine.js';
import { MISSION_EVENT_TYPES } from '../../../src/reports/events/event.types.js';

describe('the seeded report wording', () => {
  it('has a row for every event type and every phase', () => {
    const seeded = reportTemplateSeed()
      .map((row) => row.id)
      .sort();
    expect(seeded).toEqual([...MISSION_EVENT_TYPES, ...PHASE_TYPES].sort());
  });

  it.each(reportTemplateSeed().map((row) => [row.id, row] as const))(
    '%s is well-formed in both languages',
    (_id, row) => {
      expect(templateProblems(row.id, row.variants, row.legacy)).toEqual([]);
    },
  );

  it('has as many lines in Portuguese as in English', () => {
    for (const row of reportTemplateSeed()) {
      expect([row.id, row.variants['pt-BR'].length]).toEqual([row.id, row.variants.en.length]);
    }
  });
});

describe('templateProblems', () => {
  const good = { en: ['Ran {distance}.'], 'pt-BR': ['Percorreu {distance}.'] };

  it('accepts a line that prints what the event carries', () => {
    expect(templateProblems('leg_travel', good, {})).toEqual([]);
  });

  it('refuses a placeholder the event does not carry', () => {
    expect(templateProblems('leg_travel', { ...good, en: ['Hit {part}.'] }, {})[0]).toMatch(
      /\{part\} is not available/,
    );
  });

  it('refuses an empty language, an empty line and an unknown type', () => {
    expect(templateProblems('leg_travel', { en: ['x'], 'pt-BR': [] }, {})).not.toEqual([]);
    expect(templateProblems('leg_travel', { en: ['  '], 'pt-BR': ['x'] }, {})).not.toEqual([]);
    expect(templateProblems('nope', good, {})).toEqual(['nope is not an event or phase type']);
  });

  it('keeps the new-only numbers out of the wording for old reports', () => {
    const row = reportTemplateSeed().find((entry) => entry.id === 'combat_win')!;
    const legacy = { en: ['Hit for {shield}.'], 'pt-BR': ['x'] };
    expect(templateProblems('combat_win', row.variants, legacy).join()).toMatch(/older reports/);
  });

  it('lists a token set for every type', () => {
    expect(Object.keys(TEMPLATE_PLACEHOLDERS).sort()).toEqual(
      [...MISSION_EVENT_TYPES, ...PHASE_TYPES].sort(),
    );
  });
});

describe('wording edited in the Admin', () => {
  it('wins over the repo files, and an empty edit falls back to them', () => {
    const file = loadTemplateVariants('en', 'leg_travel');
    setTemplateOverrides(
      new Map([['en/leg_travel', { variants: ['Edited {distance}.'], legacy: [] }]]),
    );
    expect(loadTemplateVariants('en', 'leg_travel')).toEqual(['Edited {distance}.']);
    expect(loadTemplateVariants('pt-BR', 'leg_travel')).not.toEqual(['Edited {distance}.']);
    setTemplateOverrides(new Map([['en/leg_travel', { variants: [], legacy: [] }]]));
    expect(loadTemplateVariants('en', 'leg_travel')).toEqual(file);
    expect(loadLegacyVariants('en', 'combat_win').length).toBeGreaterThan(0);
    setTemplateOverrides(new Map());
  });
});
