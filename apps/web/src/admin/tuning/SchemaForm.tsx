import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as dto from '../../api/generated';

// Owner request (round 5): "can we automatically save without clicking the button" — debounced
// while typing, flushed immediately on blur (moving to another field, or closing).
const AUTO_SAVE_DEBOUNCE_MS = 1200;

interface SchemaFormProps {
  fields: dto.EntitySchemaField[];
  initialData?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>, reason: string) => void | Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  errors?: string[];
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
  fields,
  initialData = {},
  onSubmit,
  onCancel,
  submitLabel,
  errors,
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
      } else {
        initial[field.name] = initialData[field.name] ?? '';
      }
    }
    return initial;
  };
  const [values, setValues] = useState<Record<string, unknown>>(buildInitialValues);
  const [reason, setReason] = useState('');

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
    onAutoSave(payload, reasonRef.current.trim() || t('tuning.defaultReason'));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    void onSubmit(payload, reason || t('tuning.defaultReason'));
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
        <>
          <input
            id={`${field.name}-en`}
            type="text"
            value={map.en}
            onChange={(event) => handleChange(field.name, event.target.value, 'en')}
            aria-label={getFieldLabel(field, locale, 'en')}
            required={field.required}
          />
          <input
            id={`${field.name}-pt-BR`}
            type="text"
            value={map['pt-BR']}
            onChange={(event) => handleChange(field.name, event.target.value, 'pt-BR')}
            aria-label={getFieldLabel(field, locale, 'pt-BR')}
            required={field.required}
          />
        </>
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

  return (
    <form
      onSubmit={handleSubmit}
      // Any field losing focus (tabbing to the next one, or about to close) flushes the pending
      // auto-save right away instead of waiting out the full debounce.
      onBlur={autoSave ? () => flushAutoSave() : undefined}
    >
      {errors && errors.length > 0 && (
        <ul role="alert">
          {errors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}
      <div className="schema-form-grid">
        {fields.map((field) => {
          const wide = field.type === 'locale-map' || field.type === 'json';
          return (
            <div key={field.name} className={`field${wide ? ' field-wide' : ''}`}>
              <label htmlFor={field.name}>
                {getFieldLabel(field, locale)}
                {field.required && (
                  <span className="field-required" aria-label={t('tuning.required')}>
                    {t('tuning.required')}
                  </span>
                )}
              </label>
              {renderInput(field)}
              {field.min !== undefined || field.max !== undefined ? (
                <small className="field-hint">
                  {t('tuning.bounds', { min: field.min ?? '', max: field.max ?? '' })}
                </small>
              ) : null}
            </div>
          );
        })}
        <div className="field">
          <label htmlFor="reason">{t('tuning.reasonLabel')}</label>
          <input
            id="reason"
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </div>
      </div>
      <div>
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
