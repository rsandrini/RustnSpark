import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { pickLocalized } from '../../i18n/localized';
import { tuningApi } from './tuning.api';

// Admin editors for the JSON-shaped fields that used to be a raw textarea. Each one reads and
// writes the SAME JSON the server stores and validates (the server stays the authority), keeps
// any key it does not know about instead of dropping it, and sits above a collapsed "advanced
// JSON" fallback for anything the friendly controls cannot express.

type Json = Record<string, unknown>;

export interface StructuredEditorProps {
  value: unknown;
  onChange: (value: unknown) => void;
  /** The row's own id (a faction's relations list leaves it out). */
  rowId?: string;
}

const asObject = (value: unknown): Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};

function AdvancedJson({ value, onChange }: StructuredEditorProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [invalid, setInvalid] = useState(false);
  return (
    <details className="advanced-json">
      <summary>{t('tuning.structured.advanced')}</summary>
      <textarea
        aria-label={t('tuning.structured.advanced')}
        rows={5}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          try {
            onChange(event.target.value.trim() === '' ? null : (JSON.parse(event.target.value) as unknown));
            setInvalid(false);
          } catch {
            setInvalid(true);
          }
        }}
      />
      {invalid && <small className="field-error">{t('tuning.invalidJson')}</small>}
    </details>
  );
}

function withAdvanced(
  props: StructuredEditorProps,
  body: React.ReactNode,
): React.ReactElement {
  return (
    <div className="structured-editor">
      {body}
      <AdvancedJson {...props} />
    </div>
  );
}

interface FlagSpec {
  key: string;
  labelKey: string;
  helpKey: string;
}

/** A set of on/off switches stored as `{ key: true|false }` (other keys are preserved). */
function FlagsEditor({
  value,
  onChange,
  flags,
  testPrefix,
}: StructuredEditorProps & { flags: readonly FlagSpec[]; testPrefix: string }) {
  const { t } = useTranslation();
  const current = asObject(value);
  return (
    <div className="flags-editor" role="group">
      {flags.map((flag) => (
        <label key={flag.key} className="flag-row" title={t(flag.helpKey)}>
          <input
            type="checkbox"
            data-testid={`${testPrefix}-${flag.key}`}
            checked={current[flag.key] === true}
            onChange={(event) => onChange({ ...current, [flag.key]: event.target.checked })}
          />
          <span>
            <b>{t(flag.labelKey)}</b>
            <small>{t(flag.helpKey)}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

const SERVICE_FLAGS: readonly FlagSpec[] = ['buy', 'sell', 'repair', 'missions', 'passengers'].map(
  (key) => ({
    key,
    labelKey: `tuning.structured.services.${key}`,
    helpKey: `tuning.structured.services.${key}Help`,
  }),
);

export function ServicesEditor(props: StructuredEditorProps) {
  return withAdvanced(props, <FlagsEditor {...props} flags={SERVICE_FLAGS} testPrefix="service" />);
}

const SPECIAL_FLAGS: readonly FlagSpec[] = ['pressurized', 'lifeSupport'].map((key) => ({
  key,
  labelKey: `tuning.structured.special.${key}`,
  helpKey: `tuning.structured.special.${key}Help`,
}));

export function SpecialPropEditor(props: StructuredEditorProps) {
  return withAdvanced(props, <FlagsEditor {...props} flags={SPECIAL_FLAGS} testPrefix="special" />);
}

const PRESETS = ['CRUISE', 'ESCAPE', 'COMBAT'] as const;

export function EncounterPolicyEditor(props: StructuredEditorProps) {
  const { t } = useTranslation();
  const current = asObject(props.value);
  const set = (patch: Json) => props.onChange({ ...current, ...patch });
  return withAdvanced(
    props,
    <div className="structured-fields">
      <label className="flag-row">
        <input
          type="checkbox"
          data-testid="policy-missionForcesFlee"
          checked={current.missionForcesFlee === true}
          onChange={(event) => set({ missionForcesFlee: event.target.checked })}
        />
        <span>
          <b>{t('tuning.structured.policy.missionForcesFlee')}</b>
          <small>{t('tuning.structured.policy.missionForcesFleeHelp')}</small>
        </span>
      </label>
      <label>
        {t('tuning.structured.policy.preset')}
        <select
          data-testid="policy-preset"
          value={typeof current.preset === 'string' ? current.preset : ''}
          onChange={(event) =>
            set({ preset: event.target.value === '' ? undefined : event.target.value })
          }
        >
          <option value="">{t('tuning.structured.default')}</option>
          {PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {preset}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t('tuning.structured.policy.missionOwner')}
        <select
          data-testid="policy-missionOwner"
          value={typeof current.missionOwner === 'string' ? current.missionOwner : ''}
          onChange={(event) =>
            set({ missionOwner: event.target.value === '' ? undefined : event.target.value })
          }
        >
          <option value="">{t('tuning.structured.default')}</option>
          <option value="player">{t('tuning.structured.policy.owner.player')}</option>
          <option value="enemy">{t('tuning.structured.policy.owner.enemy')}</option>
        </select>
      </label>
    </div>,
  );
}

/** A checkbox group over a list of choices, stored as an array of the chosen ids. */
function ChoiceGroup({
  legend,
  options,
  chosen,
  onChange,
  testPrefix,
}: {
  legend: string;
  options: readonly { id: string; label: string }[];
  chosen: readonly string[] | undefined;
  onChange: (next: string[] | undefined) => void;
  testPrefix: string;
}) {
  const { t } = useTranslation();
  const set = new Set(chosen ?? []);
  const toggle = (id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next.size === 0 ? undefined : options.map((o) => o.id).filter((x) => next.has(x)));
  };
  return (
    <fieldset className="choice-group">
      <legend>{legend}</legend>
      <small className="muted">{chosen === undefined ? t('tuning.structured.anyOk') : ''}</small>
      <div className="choice-options">
        {options.map((option) => (
          <label key={option.id}>
            <input
              type="checkbox"
              data-testid={`${testPrefix}-${option.id}`}
              checked={set.has(option.id)}
              onChange={(event) => toggle(option.id, event.target.checked)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const NUMBER_HINTS = ['cargo', 'speed', 'minMobility'] as const;

export function MissionRequirementsEditor(props: StructuredEditorProps) {
  const { t, i18n } = useTranslation();
  const current = asObject(props.value);
  const locations = useQuery<Record<string, unknown>[]>({
    queryKey: ['tuning', 'entities', 'locations'],
    queryFn: () => tuningApi.listEntities('locations'),
  });
  const factions = useQuery<Record<string, unknown>[]>({
    queryKey: ['tuning', 'entities', 'factions'],
    queryFn: () => tuningApi.listEntities('factions'),
  });
  const types = [...new Set((locations.data ?? []).map((row) => String(row.type)))].sort();
  const factionOptions = (factions.data ?? []).map((row) => ({
    id: String(row.id),
    label: pickLocalized(row.displayName as { en: string; 'pt-BR': string }, i18n.language) || String(row.id),
  }));
  const set = (patch: Json) => {
    const next: Json = { ...current, ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    props.onChange(next);
  };
  return withAdvanced(
    props,
    <div className="structured-fields">
      <ChoiceGroup
        legend={t('tuning.structured.requirements.originTypes')}
        options={types.map((id) => ({ id, label: id }))}
        chosen={Array.isArray(current.originTypes) ? (current.originTypes as string[]) : undefined}
        onChange={(next) => set({ originTypes: next })}
        testPrefix="req-type"
      />
      <ChoiceGroup
        legend={t('tuning.structured.requirements.originFactions')}
        options={factionOptions}
        chosen={Array.isArray(current.originFactions) ? (current.originFactions as string[]) : undefined}
        onChange={(next) => set({ originFactions: next })}
        testPrefix="req-faction"
      />
      <div className="structured-numbers">
        {NUMBER_HINTS.map((key) => (
          <label key={key} title={t(`tuning.structured.requirements.${key}Help`)}>
            {t(`tuning.structured.requirements.${key}`)}
            <input
              type="number"
              min={0}
              step="any"
              data-testid={`req-${key}`}
              placeholder={t('tuning.structured.default')}
              value={typeof current[key] === 'number' ? (current[key]) : ''}
              onChange={(event) =>
                set({ [key]: event.target.value === '' ? undefined : Number(event.target.value) })
              }
            />
          </label>
        ))}
      </div>
    </div>,
  );
}

/** Name → number rows for parameter blocks whose keys are not fixed (reward/deadline extras). */
export function NumberMapEditor(props: StructuredEditorProps) {
  const { t } = useTranslation();
  const current = asObject(props.value);
  const entries = Object.entries(current);
  return withAdvanced(
    props,
    <div className="structured-fields">
      {entries.length === 0 && <p className="muted">{t('tuning.structured.noParams')}</p>}
      {entries.map(([key, entry]) => (
        <div key={key} className="kv-row">
          <b>{key}</b>
          <input
            type="number"
            step="any"
            aria-label={key}
            value={typeof entry === 'number' ? entry : ''}
            onChange={(event) => props.onChange({ ...current, [key]: Number(event.target.value) })}
          />
          <button
            type="button"
            onClick={() => {
              const { [key]: _removed, ...rest } = current;
              void _removed;
              props.onChange(rest);
            }}
          >
            {t('tuning.connectorRules.removeForbidden')}
          </button>
        </div>
      ))}
      <AddParam onAdd={(key) => props.onChange({ ...current, [key]: 0 })} />
    </div>,
  );
}

function AddParam({ onAdd }: { onAdd: (key: string) => void }) {
  const { t } = useTranslation();
  const [key, setKey] = useState('');
  return (
    <div className="kv-row">
      <input
        aria-label={t('tuning.structured.paramName')}
        placeholder={t('tuning.structured.paramName')}
        value={key}
        onChange={(event) => setKey(event.target.value)}
      />
      <button
        type="button"
        disabled={key.trim() === ''}
        onClick={() => {
          onAdd(key.trim());
          setKey('');
        }}
      >
        {t('tuning.structured.addParam')}
      </button>
    </div>
  );
}

const TIERS = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const;
const PERCENT = 100;

interface TierRow {
  tier: string;
  chance: number;
}

/** Drop-table tiers: one row per rarity with its chance in percent; the total is shown live. */
export function TiersEditor(props: StructuredEditorProps) {
  const { t } = useTranslation();
  const rows: TierRow[] = Array.isArray(props.value)
    ? (props.value as TierRow[]).filter((row) => typeof row?.tier === 'string')
    : [];
  const total = Math.round(rows.reduce((sum, row) => sum + (row.chance || 0), 0) * PERCENT * 100) / 100;
  const update = (next: TierRow[]) => props.onChange(next);
  return withAdvanced(
    props,
    <div className="structured-fields">
      {rows.map((row, index) => (
        <div key={index} className="kv-row">
          <select
            aria-label={t('tuning.structured.tier')}
            value={row.tier}
            onChange={(event) =>
              update(rows.map((r, i) => (i === index ? { ...r, tier: event.target.value } : r)))
            }
          >
            {TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {t(`parts.rarities.${tier}`, { defaultValue: tier })}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            max={PERCENT}
            step="any"
            aria-label={t('tuning.structured.chancePercent')}
            data-testid={`tier-chance-${index}`}
            value={Math.round(row.chance * PERCENT * 100) / 100}
            onChange={(event) =>
              update(
                rows.map((r, i) =>
                  i === index ? { ...r, chance: Number(event.target.value) / PERCENT } : r,
                ),
              )
            }
          />
          <span>{t('tuning.structured.percentSign')}</span>
          <button type="button" onClick={() => update(rows.filter((_, i) => i !== index))}>
            {t('tuning.connectorRules.removeForbidden')}
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => update([...rows, { tier: TIERS[Math.min(rows.length, TIERS.length - 1)]!, chance: 0 }])}
      >
        {t('tuning.structured.addTier')}
      </button>
      <p
        className={total === PERCENT ? 'muted' : 'error-text'}
        role="status"
        data-testid="tier-total"
      >
        {t('tuning.structured.tierTotal', { total })}
      </p>
    </div>,
  );
}

const RELATIONS = ['neutral', 'hostile', 'ally'] as const;

/** Faction relations: one select per other faction, written straight into the form's value. */
export function RelationsEditor(props: StructuredEditorProps) {
  const { t, i18n } = useTranslation();
  const current = asObject(props.value) as Record<string, string>;
  const factions = useQuery<Record<string, unknown>[]>({
    queryKey: ['tuning', 'entities', 'factions'],
    queryFn: () => tuningApi.listEntities('factions'),
  });
  const others = (factions.data ?? []).filter((row) => String(row.id) !== props.rowId);
  return withAdvanced(
    props,
    <table className="relations-table">
      <thead>
        <tr>
          <th>{t('tuning.faction')}</th>
          <th>{t('tuning.relation')}</th>
        </tr>
      </thead>
      <tbody>
        {others.map((row) => {
          const id = String(row.id);
          return (
            <tr key={id}>
              <td>{pickLocalized(row.displayName as { en: string; 'pt-BR': string }, i18n.language) || id}</td>
              <td>
                <select
                  aria-label={`${t('tuning.relation')} ${id}`}
                  value={current[id] ?? 'neutral'}
                  onChange={(event) => props.onChange({ ...current, [id]: event.target.value })}
                >
                  {RELATIONS.map((relation) => (
                    <option key={relation} value={relation}>
                      {t(`tuning.${relation}`)}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>,
  );
}

/** Which structured editor (if any) a json field gets, by `entity.field`. */
export const STRUCTURED_EDITORS: Record<string, (props: StructuredEditorProps) => React.ReactElement> = {
  'locations.services': ServicesEditor,
  'parts.specialProp': SpecialPropEditor,
  'mission-templates.requirements': MissionRequirementsEditor,
  'mission-templates.rewardCalc': NumberMapEditor,
  'mission-templates.deadlineCalc': NumberMapEditor,
  'mission-templates.encounterPolicy': EncounterPolicyEditor,
  'drop-tables.tiers': TiersEditor,
  'factions.relations': RelationsEditor,
};
