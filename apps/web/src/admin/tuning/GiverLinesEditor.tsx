import { useTranslation } from 'react-i18next';
import { MentorStepSchema, MissionTypeSchema } from '@rustandspark/contract';

// Admin editor for a giver's line pools (plan §4, §5): one bilingual list per key. The keys are
// data — the server picks a pool by mission type and moment, chosen by the mission seed — so
// every known key gets a section and any extra key already stored is shown and preserved. An
// empty pool simply means "fall back to the template description", so the owner can add voice
// gradually. Placeholders ({destination}, {cargo}, {reward}) are filled server-side.
export interface GiverLine {
  en: string;
  'pt-BR': string;
}

export type GiverLinePools = Record<string, GiverLine[]>;

export interface GiverLinesEditorProps {
  value: GiverLinePools | null | undefined;
  onChange: (next: GiverLinePools) => void;
}

/** Every pool the server may read (seed-data/quest-givers.ts + givers.service.ts); a missing key
    is fine (template fallback). Mission types keep their UPPERCASE ids, as the API writes them. */
export const GIVER_POOL_KEYS: readonly string[] = [
  ...MissionTypeSchema.options.map((type) => `offer.${type}`),
  'accepted',
  'report.success',
  'report.partial',
  'report.failure',
  'first_flight',
  'tutorial.welcome',
  ...MentorStepSchema.options.flatMap((step) => [`tutorial.${step}`, `tutorial.${step}.done`]),
  'tutorial.finished',
  'tutorial.first_failure',
  'tutorial.low_fuel',
];

// i18next resolves keys by splitting on dots, so a pool key like "tutorial.build.done" cannot be
// a literal key path; the label keys flatten the dots ("tutorial_build_done").
const poolLabelKey = (key: string): string => key.replace(/\./g, '_');

const asLine = (raw: unknown): GiverLine => {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    en: typeof record.en === 'string' ? record.en : '',
    'pt-BR': typeof record['pt-BR'] === 'string' ? record['pt-BR'] : '',
  };
};

export function GiverLinesEditor({ value, onChange }: GiverLinesEditorProps) {
  const { t } = useTranslation();
  const pools = value ?? {};
  const keys = [...new Set([...GIVER_POOL_KEYS, ...Object.keys(pools)])];

  const setPool = (key: string, lines: GiverLine[]): void => {
    const next = { ...pools };
    if (lines.length === 0) delete next[key];
    else next[key] = lines;
    onChange(next);
  };

  return (
    <div className="giver-lines-editor" role="group">
      <p className="muted">{t('admin.givers.linesHelp')}</p>
      {keys.map((key) => {
        const lines = (pools[key] ?? []).map(asLine);
        return (
          <fieldset key={key} className="giver-pool" data-testid={`giver-pool-${key}`}>
            <legend>{t(`admin.givers.pools.${poolLabelKey(key)}`, { defaultValue: key })}</legend>
            {lines.length === 0 && <p className="muted">{t('admin.givers.emptyPool')}</p>}
            {lines.map((line, index) => (
              <div key={index} className="kv-row">
                <input
                  aria-label={`${t('admin.givers.lineEn')} ${key} ${index + 1}`}
                  data-testid={`giver-line-${key}-${index}-en`}
                  value={line.en}
                  onChange={(event) =>
                    setPool(
                      key,
                      lines.map((current, i) =>
                        i === index ? { ...current, en: event.target.value } : current,
                      ),
                    )
                  }
                />
                <input
                  aria-label={`${t('admin.givers.linePt')} ${key} ${index + 1}`}
                  data-testid={`giver-line-${key}-${index}-pt`}
                  value={line['pt-BR']}
                  onChange={(event) =>
                    setPool(
                      key,
                      lines.map((current, i) =>
                        i === index ? { ...current, 'pt-BR': event.target.value } : current,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  data-testid={`giver-remove-${key}-${index}`}
                  onClick={() => setPool(key, lines.filter((_, i) => i !== index))}
                >
                  {t('admin.givers.removeLine')}
                </button>
              </div>
            ))}
            <button
              type="button"
              data-testid={`giver-add-${key}`}
              onClick={() => setPool(key, [...lines, { en: '', 'pt-BR': '' }])}
            >
              {t('admin.givers.addLine')}
            </button>
          </fieldset>
        );
      })}
    </div>
  );
}
