import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type * as dto from '../../api/generated';
import { ConnectorRulesEditor, type ConnectorRules } from './ConnectorRulesEditor';
import { GridCellsEditor } from './GridCellsEditor';
import { tuningApi } from './tuning.api';
import { STRUCTURED_EDITORS } from './StructuredEditors';
import { pickLocalized } from '../../i18n/localized';

// Owner request (round 5): "can we automatically save without clicking the button" — debounced
// while typing, flushed immediately on blur (moving to another field, or closing).
const AUTO_SAVE_DEBOUNCE_MS = 1200;

// Locale codes as field sub-labels — codes, not translated words, so no i18n keys.
const LOCALE_CODES: Record<string, string> = { en: 'EN', 'pt-BR': 'PT-BR' };

/** Text input for a place's type, suggesting the kinds that already exist. */
function LocationTypeInput({
  id,
  value,
  label,
  onChange,
}: {
  id: string;
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const { data: rows } = useQuery<Record<string, unknown>[]>({
    queryKey: ['tuning', 'entities', 'locations'],
    queryFn: () => tuningApi.listEntities('locations'),
  });
  const known = [...new Set((rows ?? []).map((row) => String(row.type)))].sort();
  return (
    <>
      <input
        id={id}
        list={`${id}-types`}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={`${id}-types`}>
        {known.map((type) => (
          <option key={type} value={type} />
        ))}
      </datalist>
    </>
  );
}

/** A select of another entity's rows (a foreign key), labelled by their localized name. */
function ReferenceSelect({
  entity,
  id,
  value,
  required,
  label,
  onChange,
}: {
  entity: string;
  id: string;
  value: string;
  required: boolean;
  label: string;
  onChange: (value: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { data: rows } = useQuery<Record<string, unknown>[]>({
    queryKey: ['tuning', 'entities', entity],
    queryFn: () => tuningApi.listEntities(entity),
  });
  const options = (rows ?? []).map((row) => {
    const rowId = String(row.id ?? row.partType);
    const name = row.displayName;
    const text =
      typeof name === 'object' && name !== null
        ? pickLocalized(name as { en: string; 'pt-BR': string }, i18n.language)
        : '';
    return { value: rowId, label: text !== '' && text !== rowId ? `${text} (${rowId})` : rowId };
  });
  // A stored value that no longer exists must still show, never silently blank.
  const known = options.some((option) => option.value === value);
  return (
    <select
      id={id}
      value={value}
      required={required}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{t('tuning.chooseOne')}</option>
      {!known && value !== '' && <option value={value}>{value}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** A titled group of fields in the details column (field names; any field not listed lands in a
    trailing untitled group so nothing is ever hidden). */
export interface FormIssue {
  key: string;
  message: string;
}

export interface FormSection {
  titleKey: string;
  fields: readonly string[];
}

interface SchemaFormProps {
  /** The admin entity being edited (picks structured editors and help text per field). */
  entity?: string;
  /** The row's own id, for editors that must leave it out (a faction's relations). */
  rowId?: string;
  fields: dto.EntitySchemaField[];
  sections?: readonly FormSection[];
  initialData?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>, reason: string) => void | Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  errors?: string[];
  /** Server validation problems: shown as a summary and under the field each one names. */
  issues?: readonly FormIssue[];
  /** Only while editing an existing row — never while creating one: auto-saving a brand-new,
      still-incomplete entity on every field blur would create partial/duplicate rows, not just
      save a keystroke. */
  autoSave?: boolean;
  onAutoSave?: (data: Record<string, unknown>, reason: string) => void;
  autoSaveStatus?: 'idle' | 'saving' | 'saved';
}

function buildPayload(
  values: Record<string, unknown>,
  fields: dto.EntitySchemaField[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.name];
    if (value === '' || value === null || value === undefined) continue;
    payload[field.name] = value;
  }
  return payload;
}

function getFieldLabel(field: dto.EntitySchemaField, locale: string, subKey?: string): string {
  const description = field.description?.[locale as 'en' | 'pt-BR'] ?? field.name;
  return subKey ? `${description} (${subKey})` : description;
}

// Audit reason as a version tag instead of free-text nobody wants to type: a timestamped
// auto version is prefilled as the field's VALUE (editable); clearing it falls back to a
// freshly generated one on submit — the version is never empty.
function generateAutoVersion(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `auto-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function parseValue(
  value: string,
  type: dto.EntityFieldType,
): string | number | boolean | Record<string, unknown> | null {
  if (type === 'integer') return value === '' ? null : Number.parseInt(value, 10);
  if (type === 'float') return value === '' ? null : Number.parseFloat(value);
  if (type === 'boolean') return value === 'true';
  if (type === 'json') {
    if (value.trim() === '') return null;
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return value;
    }
  }
  return value;
}

function stringifyForInput(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

export function SchemaForm({
  entity,
  rowId,
  fields,
  sections,
  initialData = {},
  onSubmit,
  onCancel,
  submitLabel,
  errors,
  issues = [],
  autoSave = false,
  onAutoSave,
  autoSaveStatus = 'idle',
}: SchemaFormProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const buildInitialValues = () => {
    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.type === 'locale-map') {
        const existing = (initialData[field.name] as Record<string, string> | undefined) ?? {};
        initial[field.name] = { en: existing.en ?? '', 'pt-BR': existing['pt-BR'] ?? '' };
      } else if (field.type === 'boolean') {
        initial[field.name] = initialData[field.name] ?? false;
      } else if (field.type === 'connector-rules' || field.type === 'grid-cells') {
        initial[field.name] = initialData[field.name] ?? undefined;
      } else {
        initial[field.name] = initialData[field.name] ?? '';
      }
    }
    return initial;
  };
  const [values, setValues] = useState<Record<string, unknown>>(buildInitialValues);
  const [reason, setReason] = useState(() => generateAutoVersion());

  // Refs so the debounced/blur-triggered flush always sees the latest edit, never a value
  // frozen at the moment the timer was scheduled or the effect was set up.
  const valuesRef = useRef(values);
  const reasonRef = useRef(reason);
  reasonRef.current = reason;
  const lastSavedSnapshot = useRef(JSON.stringify(buildPayload(values, fields)));
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushAutoSave = () => {
    if (autoSaveTimer.current !== null) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    if (!autoSave || onAutoSave === undefined) return;
    const payload = buildPayload(valuesRef.current, fields);
    const snapshot = JSON.stringify(payload);
    if (snapshot === lastSavedSnapshot.current) return;
    lastSavedSnapshot.current = snapshot;
    onAutoSave(payload, reasonRef.current.trim() || generateAutoVersion());
  };
  const flushAutoSaveRef = useRef(flushAutoSave);
  flushAutoSaveRef.current = flushAutoSave;

  const scheduleAutoSave = () => {
    if (!autoSave) return;
    if (autoSaveTimer.current !== null) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => flushAutoSaveRef.current(), AUTO_SAVE_DEBOUNCE_MS);
  };

  // Closing the popup — any way (Cancel, the popup's own Close, backdrop, Escape) — unmounts
  // this form; flush whatever's still pending so the very last edit is never the one that's lost.
  useEffect(() => {
    return () => {
      if (autoSaveTimer.current !== null) clearTimeout(autoSaveTimer.current);
      flushAutoSaveRef.current();
    };
  }, []);

  const handleChange = (name: string, value: unknown, subKey?: string) => {
    setValues((prev) => {
      const next = subKey
        ? { ...prev, [name]: { ...((prev[name] as Record<string, unknown> | undefined) ?? {}), [subKey]: value } }
        : { ...prev, [name]: value };
      valuesRef.current = next;
      return next;
    });
    scheduleAutoSave();
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (autoSaveTimer.current !== null) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    const payload = buildPayload(values, fields);
    lastSavedSnapshot.current = JSON.stringify(payload);
    void onSubmit(payload, reason.trim() || generateAutoVersion());
  };

  const renderInput = (field: dto.EntitySchemaField) => {
    const value = values[field.name];

    if (field.type === 'boolean') {
      return (
        <select
          id={field.name}
          name={field.name}
          value={stringifyForInput(value)}
          onChange={(event) => handleChange(field.name, event.target.value === 'true')}
          aria-label={getFieldLabel(field, locale)}
        >
          <option value="true">{t('tuning.yes')}</option>
          <option value="false">{t('tuning.no')}</option>
        </select>
      );
    }

    if (field.type === 'enum' && field.enumValues) {
      return (
        <select
          id={field.name}
          name={field.name}
          value={stringifyForInput(value)}
          onChange={(event) => handleChange(field.name, event.target.value)}
          aria-label={getFieldLabel(field, locale)}
        >
          <option value="">{t('tuning.select')}</option>
          {field.enumValues.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    if (field.type === 'locale-map') {
      const map = (value as Record<string, string> | undefined) ?? { en: '', 'pt-BR': '' };
      return (
        <div className="locale-pair">
          <div className="locale-input">
            <label className="lbl" htmlFor={`${field.name}-en`}>
              {LOCALE_CODES.en}
            </label>
            <input
              id={`${field.name}-en`}
              type="text"
              value={map.en}
              onChange={(event) => handleChange(field.name, event.target.value, 'en')}
              aria-label={getFieldLabel(field, locale, 'en')}
              required={field.required}
            />
          </div>
          <div className="locale-input">
            <label className="lbl" htmlFor={`${field.name}-pt-BR`}>
              {LOCALE_CODES['pt-BR']}
            </label>
            <input
              id={`${field.name}-pt-BR`}
              type="text"
              value={map['pt-BR']}
              onChange={(event) => handleChange(field.name, event.target.value, 'pt-BR')}
              aria-label={getFieldLabel(field, locale, 'pt-BR')}
              required={field.required}
            />
          </div>
        </div>
      );
    }

    const Structured =
      entity === undefined ? undefined : STRUCTURED_EDITORS[`${entity}.${field.name}`];
    if (Structured !== undefined) {
      return (
        <Structured
          value={value}
          rowId={rowId}
          onChange={(next) => handleChange(field.name, next)}
        />
      );
    }

    // A place type is free text with the known types suggested (a new kind of place is allowed).
    if (entity === 'locations' && field.name === 'type') {
      return (
        <LocationTypeInput
          id={field.name}
          value={typeof value === 'string' ? value : ''}
          label={getFieldLabel(field, locale)}
          onChange={(next) => handleChange(field.name, next)}
        />
      );
    }

    if (field.type === 'json') {
      return (
        <textarea
          id={field.name}
          value={stringifyForInput(value)}
          onChange={(event) => handleChange(field.name, parseValue(event.target.value, 'json'))}
          aria-label={getFieldLabel(field, locale)}
          rows={4}
        />
      );
    }

    if (field.type === 'grid-cells') {
      return (
        <GridCellsEditor
          value={value as [number, number][] | undefined}
          onChange={(cells) => handleChange(field.name, cells)}
          target={
            typeof values.cellTarget === 'number' && Number.isFinite(values.cellTarget)
              ? values.cellTarget
              : undefined
          }
        />
      );
    }

    if (field.references !== undefined && field.type === 'string') {
      return (
        <ReferenceSelect
          entity={field.references}
          id={field.name}
          value={typeof value === 'string' ? value : ''}
          required={field.required}
          label={getFieldLabel(field, locale)}
          onChange={(next) => handleChange(field.name, next)}
        />
      );
    }

    if (field.type === 'connector-rules') {
      return (
        <ConnectorRulesEditor
          value={value as ConnectorRules | null | undefined}
          onChange={(rules) => handleChange(field.name, rules)}
          w={typeof values.w === 'number' ? values.w : 1}
          h={typeof values.h === 'number' ? values.h : 1}
          partClass={typeof values.partClass === 'string' ? values.partClass : undefined}
        />
      );
    }

    const inputType = field.type === 'integer' || field.type === 'float' ? 'number' : 'text';
    return (
      <input
        id={field.name}
        type={inputType}
        value={stringifyForInput(value)}
        min={field.min}
        max={field.max}
        onChange={(event) => handleChange(field.name, parseValue(event.target.value, field.type))}
        aria-label={getFieldLabel(field, locale)}
        required={field.required}
      />
    );
  };

  // Fields with a drawing/visual editor take the main pane beside the details column.
  const isMain = (field: dto.EntitySchemaField) =>
    field.type === 'grid-cells' || field.type === 'connector-rules';
  const mainFields = fields.filter(isMain);
  const sideFields = fields.filter((field) => !isMain(field));
  const listed = new Set((sections ?? []).flatMap((section) => section.fields));
  const sectionGroups: { titleKey: string | null; fields: dto.EntitySchemaField[] }[] = [
    ...(sections ?? []).map((section) => ({
      titleKey: section.titleKey,
      fields: sideFields.filter((field) => section.fields.includes(field.name)),
    })),
    { titleKey: null, fields: sideFields.filter((field) => !listed.has(field.name)) },
  ].filter((group) => group.fields.length > 0);

  // Validation messages come straight from the server's zod rules: a missing value reads as
  // "Required" instead of "Invalid input: expected string, received undefined".
  const readable = (message: string): string =>
    /expected .* received undefined/.test(message) ? t('tuning.errors.required') : message;
  const fieldOf = (key: string): string => key.split('.')[0] ?? key;
  const labelFor = (key: string): string => {
    const field = fields.find((candidate) => candidate.name === fieldOf(key));
    return field === undefined ? key : getFieldLabel(field, locale);
  };
  const issuesByField = new Map<string, string[]>();
  for (const issue of issues) {
    const name = fieldOf(issue.key);
    issuesByField.set(name, [...(issuesByField.get(name) ?? []), readable(issue.message)]);
  }

  // What the field means, in plain words (tuning.help.<entity>.<field>); empty when none is written.
  const helpFor = (field: dto.EntitySchemaField): string =>
    entity === undefined
      ? ''
      : t(`tuning.help.${entity}.${field.name}`, { defaultValue: '' });

  const renderField = (field: dto.EntitySchemaField) => {
    const wide =
      field.type === 'locale-map' ||
      field.type === 'json' ||
      field.type === 'grid-cells' ||
      field.type === 'connector-rules';
    return (
      <div key={field.name} className={`field${wide ? ' field-wide' : ''}`}>
        <label className="lbl" htmlFor={field.name}>
          {getFieldLabel(field, locale)}
          {field.required && (
            <span className="field-required" aria-label={t('tuning.required')}>
              {t('tuning.required')}
            </span>
          )}
        </label>
        {helpFor(field) !== '' && <small className="field-help">{helpFor(field)}</small>}
        {renderInput(field)}
        {(issuesByField.get(field.name) ?? []).map((message) => (
          <small key={message} className="field-error" role="alert">
            {message}
          </small>
        ))}
        {field.min !== undefined || field.max !== undefined ? (
          <small className="field-hint">
            {t('tuning.bounds', { min: field.min ?? '', max: field.max ?? '' })}
          </small>
        ) : null}
      </div>
    );
  };

  return (
    <form
      onSubmit={handleSubmit}
      // Any field losing focus (tabbing to the next one, or about to close) flushes the pending
      // auto-save right away instead of waiting out the full debounce.
      onBlur={autoSave ? () => flushAutoSave() : undefined}
    >
      {issues.length > 0 && (
        <div className="form-error-summary" role="alert">
          <b>{t('tuning.errors.fixThese', { count: issues.length })}</b>
          <ul>
            {issues.map((issue, index) => (
              <li key={`${issue.key}-${index}`}>
                <b>{labelFor(issue.key)}</b>
                {t('tuning.errors.separator')}
                {readable(issue.message)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {errors && errors.length > 0 && (
        <ul role="alert">
          {errors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}
      {/* A form with a cell-drawing field (ship formats) is laid out as a left column of details and
          the drawing area centered beside it, instead of a left-aligned grid with every detail
          stacked underneath (owner request). Other forms keep the single paired-field grid. */}
      <div className={mainFields.length > 0 ? 'schema-form-split' : undefined}>
        <div className="schema-form-side">
          {sectionGroups.map((group) => (
            <section key={group.titleKey ?? 'rest'} className="schema-form-section">
              {group.titleKey !== null && <h3>{t(group.titleKey)}</h3>}
              <div className="schema-form-grid">{group.fields.map((field) => renderField(field))}</div>
            </section>
          ))}
          <div className="schema-form-grid">
            <div className="field">
              <label className="lbl" htmlFor="reason">
                {t('tuning.versionLabel')}
              </label>
              <input
                id="reason"
                type="text"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
              />
            </div>
          </div>
        </div>
        {mainFields.length > 0 && (
          <div className="schema-form-main">{mainFields.map((field) => renderField(field))}</div>
        )}
      </div>
      <div className="schema-form-actions">
        <button type="submit">{submitLabel ?? t('tuning.save')}</button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            {t('tuning.cancel')}
          </button>
        )}
        {autoSave && autoSaveStatus !== 'idle' && (
          <span className="auto-save-status" role="status">
            {autoSaveStatus === 'saving' ? t('tuning.autoSaving') : t('tuning.autoSaved')}
          </span>
        )}
      </div>
    </form>
  );
}
