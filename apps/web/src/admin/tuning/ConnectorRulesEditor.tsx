import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ConnectorGrid, KindIcon } from '../../features/parts/connector-grid';
import { tuningApi } from './tuning.api';

type Kind = 'none' | 'central' | 'split' | 'universal';
type Side = 'N' | 'E' | 'S' | 'W';
const KINDS: readonly Kind[] = ['none', 'central', 'split', 'universal'];
const SIDES: readonly Side[] = ['N', 'E', 'S', 'W'];
const MAX_SIDES = 4;
const PREVIEW_DEBOUNCE_MS = 350;
const PREVIEW_SAMPLES = 6;
const COMBOS_SHOWN = 8;
const PERCENT = 100;

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
  /** The part's footprint and class, for the preview and the engine/weapon facing-side lock. */
  w?: number;
  h?: number;
  partClass?: string;
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

const isDirectional = (partClass: string | undefined): boolean =>
  partClass === 'ENGINE' || partClass === 'WEAPON';

/** A ready-made rule set. Engines/weapons keep their facing side W at none. */
function preset(kinds: readonly Kind[], oneKindPerPart: boolean, directional: boolean): ConnectorRules {
  const open = kinds.map((kind) => ({ kind, weight: 1 }));
  const closed = [{ kind: 'none' as const, weight: 1 }];
  return {
    sides: { N: open, E: open, S: open, W: directional ? closed : open },
    ...(oneKindPerPart ? { oneKindPerPart: true } : {}),
  };
}

// Admin editor for a part type's connector GENERATION rules. Each side of the part is a card of
// kind chips (central = one dot, split = two small dots, universal = three; click to allow, set a
// relative weight); a live panel shows, from the server's own generator, every combination it can
// roll with its chance plus a few sample parts. The rules are only read when a part is generated:
// the generated layout is stored on the part and never changes.
export function ConnectorRulesEditor({ value, onChange, w = 1, h = 1, partClass }: ConnectorRulesEditorProps) {
  const { t } = useTranslation();
  const rules = value ?? EMPTY;
  const forbidden = rules.forbidden ?? [];
  const directional = isDirectional(partClass);

  const setForbidden = (list: Partial<Record<Side, Kind>>[]) => {
    const { forbidden: _removed, ...rest } = rules;
    void _removed;
    onChange(list.length === 0 ? rest : { ...rest, forbidden: list });
  };

  // The preview follows the rules a moment after the last edit.
  const [debounced, setDebounced] = useState(JSON.stringify(rules));
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(JSON.stringify(rules)), PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rules]);
  const preview = useQuery({
    queryKey: ['tuning', 'connectorPreview', debounced, w, h, partClass ?? ''],
    queryFn: () =>
      tuningApi.previewConnectorRules({
        rules: JSON.parse(debounced) as unknown,
        w,
        h,
        partClass: partClass ?? 'UTILITY',
        samples: PREVIEW_SAMPLES,
      }),
    enabled: value !== null && value !== undefined,
    retry: false,
  });

  return (
    <div className="connector-rules-editor">
      {value === null || value === undefined ? (
        <p className="muted">{t('tuning.connectorRules.notConfigured')}</p>
      ) : null}

      <div className="rules-presets" role="group" aria-label={t('tuning.connectorRules.presets')}>
        <span className="muted">{t('tuning.connectorRules.presets')}</span>
        <button
          type="button"
          data-testid="rules-preset-central"
          onClick={() => onChange(preset(['central'], false, directional))}
        >
          {t('tuning.connectorRules.presetCentral')}
        </button>
        <button
          type="button"
          data-testid="rules-preset-mixed"
          onClick={() => onChange(preset(['central', 'split', 'universal'], true, directional))}
        >
          {t('tuning.connectorRules.presetMixed')}
        </button>
        <button
          type="button"
          data-testid="rules-preset-universal"
          onClick={() => onChange(preset(['universal'], false, directional))}
        >
          {t('tuning.connectorRules.presetUniversal')}
        </button>
      </div>

      <div className="rules-diagram" aria-label={t('tuning.connectorRules.diagram')}>
        {SIDES.map((side) => {
          const locked = directional && side === 'W';
          return (
            <div key={side} className={`rules-side rules-side-${side}${locked ? ' locked' : ''}`}>
              <b className="rules-side-name">{side}</b>
              <div className="rules-chips">
                {KINDS.map((kind) => {
                  const weight = weightOf(rules, side, kind);
                  const active = weight > 0;
                  const disabled = locked && kind !== 'none';
                  return (
                    <div key={kind} className={`rules-chip${active ? ' on' : ''}`}>
                      <button
                        type="button"
                        aria-pressed={active}
                        disabled={disabled}
                        data-testid={`rules-chip-${side}-${kind}`}
                        aria-label={`${side} ${t(`connectors.kinds.${kind}`)}`}
                        title={t(`connectors.kinds.${kind}`)}
                        onClick={() => onChange(withWeight(rules, side, kind, active ? 0 : 1))}
                      >
                        <KindIcon kind={kind} />
                      </button>
                      {active && (
                        <input
                          type="number"
                          min={0}
                          className="rules-weight"
                          data-testid={`rules-weight-${side}-${kind}`}
                          aria-label={`${side} ${t(`connectors.kinds.${kind}`)} ${t('tuning.connectorRules.weight')}`}
                          value={weight}
                          disabled={disabled}
                          onChange={(event) =>
                            onChange(withWeight(rules, side, kind, Math.max(0, Number(event.target.value))))
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              {locked && <small className="muted">{t('tuning.connectorRules.facingLocked')}</small>}
            </div>
          );
        })}
        <div className="rules-part" aria-hidden="true">
          {t('tuning.connectorRules.size', { w, h })}
        </div>
      </div>
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
                    const updated =
                      event.target.value === '' ? others : { ...others, [side]: event.target.value as Kind };
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

      {value !== null && value !== undefined && (
        <section className="rules-preview" aria-label={t('tuning.connectorRules.previewTitle')}>
          <h4>{t('tuning.connectorRules.previewTitle')}</h4>
          {preview.isError && <p className="muted">{t('tuning.connectorRules.previewUnavailable')}</p>}
          {preview.data?.problem !== undefined && preview.data.problem !== null && (
            <p role="alert" className="error-text" data-testid="rules-problem">
              {preview.data.problem}
            </p>
          )}
          {preview.data !== undefined && preview.data.problem === null && (
            <>
              <ul className="rules-combos" data-testid="rules-combos">
                {preview.data.combos.slice(0, COMBOS_SHOWN).map((entry) => (
                  <li key={SIDES.map((side) => entry.sides[side]).join('-')}>
                    <b>{t('tuning.connectorRules.percent', { value: Math.round(entry.probability * PERCENT * 10) / 10 })}</b>
                    {SIDES.map((side) => (
                      <span key={side} className="rules-combo-side">
                        {side}
                        <KindIcon kind={entry.sides[side]} />
                      </span>
                    ))}
                  </li>
                ))}
                {preview.data.combos.length > COMBOS_SHOWN && (
                  <li className="muted">
                    {t('tuning.connectorRules.moreCombos', { count: preview.data.combos.length - COMBOS_SHOWN })}
                  </li>
                )}
              </ul>
              <div className="rules-samples" data-testid="rules-samples">
                {preview.data.samples.map((sample, index) => (
                  <ConnectorGrid key={index} w={w} h={h} connectors={sample.cells} />
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
