import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { tuningApi } from './tuning.api';
import type { StructuredEditorProps } from './StructuredEditors';

// Admin editor for the wording of a report line (`report-templates.variants` / `.legacy`): per language, the lines the
// report picks from (by the mission's seed, so one report always reads the same). The chips list the {placeholders}
// that kind of event can print; a line using any other one is flagged here and refused by the server.
const LOCALES = ['en', 'pt-BR'] as const;

// What each placeholder looks like in the preview line.
const SAMPLE: Record<string, string> = {
  distance: '420',
  part: 'Ion Engine',
  condition: '62',
  conditionLost: '14',
  fuelLost: '8',
  shield: '30',
  armor: '12',
  hull: '5',
  hp: '47',
  credits: '+1200',
  magnitude: '9',
  quantity: '6',
  material: 'Iron Ore',
  tuning: '…',
  demand: '…',
  find: 'a used Shield',
  origin: 'Ceres Station',
  destination: 'Hedus Yards',
};

const UP = '\u2191';
const DOWN = '\u2193';
const braced = (name: string): string => `{${name}}`;

const PLACEHOLDER = /\{([a-zA-Z]+)\}/g;

type Wording = Record<string, string[]>;

function asWording(value: unknown): Wording {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const wording: Wording = {};
  for (const locale of LOCALES) {
    const list = record[locale];
    wording[locale] = Array.isArray(list)
      ? list.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }
  return wording;
}

export function previewOf(line: string): string {
  return line.replace(PLACEHOLDER, (_all, name: string) => SAMPLE[name] ?? `{${name}}`);
}

export function unknownTokens(line: string, allowed: readonly string[]): string[] {
  return [...line.matchAll(PLACEHOLDER)]
    .map((m) => m[1]!)
    .filter((name) => !allowed.includes(name));
}

export function ReportTextEditor({
  value,
  onChange,
  rowId,
  legacy = false,
}: StructuredEditorProps & { legacy?: boolean }) {
  const { t } = useTranslation();
  const schema = useQuery({
    queryKey: ['admin', 'entity-schema', 'report-templates'],
    queryFn: () => tuningApi.getEntitySchema('report-templates'),
    staleTime: 60_000,
  });
  const listed = rowId !== undefined ? schema.data?.placeholders?.[rowId] : undefined;
  const allowed = listed ?? [];
  const wording = asWording(value);
  const shown = legacy
    ? allowed.filter((name) => !['shield', 'armor', 'hull', 'fuelLost'].includes(name))
    : allowed;

  const set = (locale: string, lines: string[]): void => {
    const next: Wording = { ...wording, [locale]: lines };
    onChange(next);
  };

  return (
    <div
      className="report-text-editor"
      role="group"
      data-testid={legacy ? 'report-legacy' : 'report-variants'}
    >
      <p className="muted">
        {t(legacy ? 'admin.reportTexts.legacyHelp' : 'admin.reportTexts.help')}{' '}
        {shown.length === 0 ? (
          t('admin.reportTexts.noPlaceholders')
        ) : (
          <span>
            {t('admin.reportTexts.placeholders')}{' '}
            {shown.map((name) => (
              <code key={name} className="chip">
                {braced(name)}
              </code>
            ))}
          </span>
        )}
      </p>
      {LOCALES.map((locale) => {
        const lines = wording[locale] ?? [];
        return (
          <fieldset key={locale} className="giver-pool" data-testid={`report-pool-${locale}`}>
            <legend>{t(locale === 'en' ? 'admin.reportTexts.en' : 'admin.reportTexts.pt')}</legend>
            {lines.length === 0 && <p className="muted">{t('admin.reportTexts.empty')}</p>}
            {lines.map((line, index) => {
              // nothing is flagged until the list of what this event can print has arrived
              const bad = listed === undefined ? [] : unknownTokens(line, shown);
              return (
                <div key={index} className="report-text-line">
                  <textarea
                    rows={2}
                    aria-label={`${t(locale === 'en' ? 'admin.reportTexts.en' : 'admin.reportTexts.pt')} ${index + 1}`}
                    data-testid={`report-line-${locale}-${index}`}
                    value={line}
                    onChange={(event) =>
                      set(
                        locale,
                        lines.map((current, i) => (i === index ? event.target.value : current)),
                      )
                    }
                  />
                  <div className="report-text-actions">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => {
                        const next = [...lines];
                        [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                        set(locale, next);
                      }}
                    >
                      {UP}
                    </button>
                    <button
                      type="button"
                      disabled={index === lines.length - 1}
                      onClick={() => {
                        const next = [...lines];
                        [next[index + 1], next[index]] = [next[index]!, next[index + 1]!];
                        set(locale, next);
                      }}
                    >
                      {DOWN}
                    </button>
                    <button
                      type="button"
                      data-testid={`report-remove-${locale}-${index}`}
                      onClick={() =>
                        set(
                          locale,
                          lines.filter((_, i) => i !== index),
                        )
                      }
                    >
                      {t('admin.reportTexts.remove')}
                    </button>
                  </div>
                  {bad.length > 0 ? (
                    <p className="error" role="alert">
                      {t('admin.reportTexts.unknown', { names: bad.map(braced).join(' ') })}
                    </p>
                  ) : (
                    <p className="muted report-text-preview">{previewOf(line)}</p>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              data-testid={`report-add-${locale}`}
              onClick={() => set(locale, [...lines, ''])}
            >
              {t('admin.reportTexts.add')}
            </button>
          </fieldset>
        );
      })}
    </div>
  );
}
