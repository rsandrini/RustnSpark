import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnalyticsRange } from '../admin.api';

const HOUR_MS = 60 * 60 * 1000;
const PRESETS = { '24h': 24 * HOUR_MS, '7d': 7 * 24 * HOUR_MS, '30d': 30 * 24 * HOUR_MS } as const;
type Preset = keyof typeof PRESETS;

export interface AnalyticsWindowState {
  /** Stable key for React Query: changes when the operator changes the range, not every render. */
  readonly key: string;
  /** Resolves the range at request time, so "last 24h" always means the last 24h. */
  readonly range: () => AnalyticsRange;
  readonly picker: React.ReactNode;
}

// Screens A–C answer for a time window (S11.3); the operator picks a preset or an explicit
// day range instead of being stuck on the server's default week.
export function useAnalyticsWindow(): AnalyticsWindowState {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<Preset | 'custom'>('7d');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const custom = preset === 'custom';
  const range = (): AnalyticsRange => {
    if (!custom) return { from: new Date(Date.now() - PRESETS[preset]).toISOString() };
    const start = from === '' ? undefined : new Date(`${from}T00:00:00`).toISOString();
    // Inclusive end day: up to the start of the next one.
    const end =
      to === '' ? undefined : new Date(new Date(`${to}T00:00:00`).getTime() + 24 * HOUR_MS);
    return { from: start, to: end?.toISOString() };
  };

  const picker = (
    <div>
      <label>
        {t('admin.window.label')}
        <select
          value={preset}
          onChange={(event) => setPreset(event.target.value as Preset | 'custom')}
        >
          {(Object.keys(PRESETS) as Preset[]).map((id) => (
            <option key={id} value={id}>
              {t(`admin.window.${id}`)}
            </option>
          ))}
          <option value="custom">{t('admin.window.custom')}</option>
        </select>
      </label>
      {custom && (
        <>
          <label>
            {t('admin.window.from')}
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            {t('admin.window.to')}
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </>
      )}
    </div>
  );

  return { key: custom ? `custom:${from}:${to}` : preset, range, picker };
}
