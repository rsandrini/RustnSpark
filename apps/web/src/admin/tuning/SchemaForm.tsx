import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type * as dto from '../../api/generated';

interface SchemaFormProps {
  fields: dto.EntitySchemaField[];
  initialData?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>, reason: string) => void | Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  errors?: string[];
}

function getFieldLabel(
  field: dto.EntitySchemaField,
  locale: string,
  subKey?: string,
): string {
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
}: SchemaFormProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [values, setValues] = useState<Record<string, unknown>>(() => {
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
  });
  const [reason, setReason] = useState('');

  const handleChange = (name: string, value: unknown, subKey?: string) => {
    setValues((prev) => {
      if (subKey) {
        const parent = (prev[name] as Record<string, unknown> | undefined) ?? {};
        return { ...prev, [name]: { ...parent, [subKey]: value } };
      }
      return { ...prev, [name]: value };
    });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const payload: Record<string, unknown> = {};
    for (const field of fields) {
      const value = values[field.name];
      if (value === '' || value === null || value === undefined) continue;
      payload[field.name] = value;
    }
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
            onChange={(event) =>
              handleChange(field.name, event.target.value, 'pt-BR')
            }
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
    <form onSubmit={handleSubmit}>
      {errors && errors.length > 0 && (
        <ul role="alert">
          {errors.map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}
      {fields.map((field) => (
        <div key={field.name}>
          <label htmlFor={field.name}>
            {getFieldLabel(field, locale)}
            {field.required && (
              <span aria-label={t('tuning.required')}>{t('tuning.required')}</span>
            )}
          </label>
          {renderInput(field)}
          {field.min !== undefined || field.max !== undefined ? (
            <small>
              {t('tuning.bounds', { min: field.min ?? '', max: field.max ?? '' })}
            </small>
          ) : null}
        </div>
      ))}
      <div>
        <label htmlFor="reason">{t('tuning.reasonLabel')}</label>
        <input
          id="reason"
          type="text"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
        />
      </div>
      <div>
        <button type="submit">{submitLabel ?? t('tuning.save')}</button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            {t('tuning.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}
