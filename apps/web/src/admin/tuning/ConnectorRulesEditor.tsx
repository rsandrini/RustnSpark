import { useTranslation } from 'react-i18next';

type Kind = 'none' | 'central' | 'split' | 'universal';
type Side = 'N' | 'E' | 'S' | 'W';
const KINDS: readonly Kind[] = ['none', 'central', 'split', 'universal'];
const SIDES: readonly Side[] = ['N', 'E', 'S', 'W'];
const MAX_SIDES = 4;

export interface ConnectorRules {
  sides: Record<Side, { kind: Kind; weight: number }[]>;
  /** Every connected side of a generated part carries the same kind. */
  oneKindPerPart?: boolean;
  maxConnected?: number;
  maxSplit?: number;
  forbidden?: Partial<Record<Side, Kind>>[];
}

export interface ConnectorRulesEditorProps {
  value: ConnectorRules | null | undefined;
  onChange: (rules: ConnectorRules) => void;
}

const EMPTY: ConnectorRules = { sides: { N: [], E: [], S: [], W: [] } };

function weightOf(rules: ConnectorRules, side: Side, kind: Kind): number {
  return rules.sides[side].find((entry) => entry.kind === kind)?.weight ?? 0;
}

function withWeight(rules: ConnectorRules, side: Side, kind: Kind, weight: number): ConnectorRules {
  const rest = rules.sides[side].filter((entry) => entry.kind !== kind);
  const next = weight > 0 ? [...rest, { kind, weight }] : rest;
  next.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  return { ...rules, sides: { ...rules.sides, [side]: next } };
}

function withLimit(
  rules: ConnectorRules,
  key: 'maxConnected' | 'maxSplit',
  raw: string,
): ConnectorRules {
  const { [key]: _removed, ...rest } = rules;
  void _removed;
  if (raw === '') return rest;
  return { ...rest, [key]: Math.min(MAX_SIDES, Math.max(0, Math.trunc(Number(raw)))) };
}

// Admin editor for a part type's connector GENERATION rules: relative weights per side and kind
// (0 = never), optional caps, and a blacklist of forbidden side combinations. The rules are only
// read when a part is generated; the generated layout is stored on the part and never changes.
export function ConnectorRulesEditor({ value, onChange }: ConnectorRulesEditorProps) {
  const { t } = useTranslation();
  const rules = value ?? EMPTY;
  const forbidden = rules.forbidden ?? [];

  const setForbidden = (list: Partial<Record<Side, Kind>>[]) => {
    const { forbidden: _removed, ...rest } = rules;
    void _removed;
    onChange(list.length === 0 ? rest : { ...rest, forbidden: list });
  };

  return (
    <div className="connector-rules-editor">
      {value === null || value === undefined ? (
        <p className="muted">{t('tuning.connectorRules.notConfigured')}</p>
      ) : null}
      <table className="connector-rules-table">
        <thead>
          <tr>
            <th>{t('tuning.connectorRules.side')}</th>
            {KINDS.map((kind) => (
              <th key={kind}>{t(`connectors.kinds.${kind}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SIDES.map((side) => (
            <tr key={side}>
              <th scope="row">{side}</th>
              {KINDS.map((kind) => (
                <td key={kind}>
                  <input
                    type="number"
                    min={0}
                    aria-label={`${side} ${t(`connectors.kinds.${kind}`)}`}
                    data-testid={`rules-weight-${side}-${kind}`}
                    value={weightOf(rules, side, kind)}
                    onChange={(event) =>
                      onChange(withWeight(rules, side, kind, Math.max(0, Number(event.target.value))))
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <small className="field-hint">{t('tuning.connectorRules.weightHelp')}</small>

      <label className="connector-rules-one-kind">
        <input
          type="checkbox"
          data-testid="rules-oneKindPerPart"
          checked={rules.oneKindPerPart === true}
          onChange={(event) => {
            const { oneKindPerPart: _removed, ...rest } = rules;
            void _removed;
            onChange(event.target.checked ? { ...rest, oneKindPerPart: true } : rest);
          }}
        />
        {t('tuning.connectorRules.oneKindPerPart')}
      </label>

      <div className="connector-rules-limits">
        {(['maxConnected', 'maxSplit'] as const).map((key) => (
          <label key={key}>
            {t(`tuning.connectorRules.${key}`)}
            <input
              type="number"
              min={0}
              max={MAX_SIDES}
              placeholder={t('tuning.connectorRules.unlimited')}
              data-testid={`rules-${key}`}
              value={rules[key] ?? ''}
              onChange={(event) => onChange(withLimit(rules, key, event.target.value))}
            />
          </label>
        ))}
      </div>

      <div className="connector-rules-forbidden">
        <b>{t('tuning.connectorRules.forbidden')}</b>
        {forbidden.map((pattern, index) => (
          <div key={index} className="connector-rules-forbidden-row">
            {SIDES.map((side) => (
              <label key={side}>
                {side}
                <select
                  data-testid={`rules-forbidden-${index}-${side}`}
                  value={pattern[side] ?? ''}
                  onChange={(event) => {
                    const { [side]: _removed, ...others } = pattern;
                    void _removed;
                    const updated = event.target.value === ''
                      ? others
                      : { ...others, [side]: event.target.value as Kind };
                    setForbidden(forbidden.map((p, i) => (i === index ? updated : p)));
                  }}
                >
                  <option value="">{t('tuning.connectorRules.any')}</option>
                  {KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {t(`connectors.kinds.${kind}`)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <button type="button" onClick={() => setForbidden(forbidden.filter((_, i) => i !== index))}>
              {t('tuning.connectorRules.removeForbidden')}
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setForbidden([...forbidden, {}])}>
          {t('tuning.connectorRules.addForbidden')}
        </button>
      </div>
    </div>
  );
}
