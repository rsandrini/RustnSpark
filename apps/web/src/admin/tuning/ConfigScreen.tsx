import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tuningApi } from './tuning.api';
import { BundleDialog } from './BundleDialog';
import type * as dto from '../../api/generated';

function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function parseConfigValue(
  value: string,
  type: string,
): string | number | boolean | Record<string, unknown> | unknown[] | null {
  if (type === 'json') {
    if (value.trim() === '') return null;
    return JSON.parse(value) as Record<string, unknown> | unknown[];
  }
  if (type === 'integer') return value === '' ? null : Number.parseInt(value, 10);
  if (type === 'number' || type === 'float') {
    return value === '' ? null : Number.parseFloat(value);
  }
  if (type === 'boolean') return value === 'true';
  return value;
}

function useLatestRevision() {
  return useQuery<dto.TuningRevisionResponse[]>({
    queryKey: ['tuning', 'revisions'],
    queryFn: () => tuningApi.listRevisions({ limit: 1 }),
  });
}

export function ConfigScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language as 'en' | 'pt-BR';
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);

  const { data: config, isLoading: isConfigLoading } = useQuery<dto.ConfigEntryResponse[]>({
    queryKey: ['tuning', 'config'],
    queryFn: () => tuningApi.listConfig(),
  });

  const { data: revisions } = useLatestRevision();
  const expectedRevision = Number(revisions?.[0]?.id ?? 0);

  const updateMutation = useMutation({
    mutationFn: (params: { key: string; value: unknown }) =>
      tuningApi.updateConfig(params.key, {
        value: params.value,
        expectedRevision,
        reason: t('tuning.configChangeReason'),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tuning', 'config'] });
      void queryClient.invalidateQueries({ queryKey: ['tuning', 'revisions'] });
      setEdits({});
      setErrors({});
    },
    onError: (error: Error, variables) => {
      setErrors((prev) => ({
        ...prev,
        [variables.key]: error.message,
      }));
    },
  });

  const resetMutation = useMutation({
    mutationFn: (key: string) =>
      tuningApi.resetConfig(key, {
        expectedRevision,
        reason: t('tuning.configResetReason'),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tuning', 'config'] });
      void queryClient.invalidateQueries({ queryKey: ['tuning', 'revisions'] });
      setConfirmReset(null);
    },
  });

  const grouped = useMemo(() => {
    const map = new Map<string, dto.ConfigEntryResponse[]>();
    if (!config) return map;
    const searchLower = search.toLowerCase();
    const filtered = config.filter(
      (entry) =>
        entry.key.toLowerCase().includes(searchLower) ||
        entry.description[locale]?.toLowerCase().includes(searchLower),
    );
    for (const entry of filtered) {
      const group = map.get(entry.group) ?? [];
      group.push(entry);
      map.set(entry.group, group);
    }
    return map;
  }, [config, search, locale]);

  const handleExport = () => {
    void (async () => {
      const bundle = await tuningApi.exportBundle();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `tuning-bundle-${bundle.version}.json`;
      link.click();
      URL.revokeObjectURL(url);
    })();
  };

  if (isConfigLoading) return <p>{t('loading')}</p>;

  return (
    <div>
      <h2>{t('tuning.configTitle')}</h2>
      <div>
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('tuning.searchPlaceholder')}
          aria-label={t('tuning.search')}
        />
        <button type="button" onClick={() => setShowImport(true)}>
          {t('tuning.import')}
        </button>
        <button type="button" onClick={handleExport}>
          {t('tuning.export')}
        </button>
      </div>
      {Array.from(grouped.entries()).map(([group, entries]) => (
        <details key={group} className="config-group" open={search.trim() !== ''}>
          <summary>
            <h3>{group}</h3>
            <span className="muted">{entries.length}</span>
          </summary>
          <div className="tuning-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('tuning.key')}</th>
                <th>{t('tuning.description')}</th>
                <th>{t('tuning.currentValue')}</th>
                <th>{t('tuning.factoryDefault')}</th>
                <th>{t('tuning.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const editValue = edits[entry.key] ?? serializeValue(entry.currentValue);
                const isJson = entry.type === 'json';
                const inputType =
                  entry.type === 'integer' || entry.type === 'float' || entry.type === 'number'
                    ? 'number'
                    : isJson
                      ? undefined
                      : 'text';
                return (
                  <tr key={entry.key}>
                    <td>
                      {entry.key}
                      {entry.modified && <span>{t('tuning.modified')}</span>}
                    </td>
                    <td>
                      {entry.description[locale]}
                      {entry.unit && <small>{t('tuning.unit', { unit: entry.unit })}</small>}
                    </td>
                    <td>
                      {isJson ? (
                        <textarea
                          value={editValue}
                          onChange={(event) =>
                            setEdits((prev) => ({
                              ...prev,
                              [entry.key]: event.target.value,
                            }))
                          }
                          rows={3}
                          aria-label={entry.key}
                        />
                      ) : (
                        <input
                          type={inputType}
                          value={editValue}
                          min={entry.min}
                          max={entry.max}
                          onChange={(event) =>
                            setEdits((prev) => ({
                              ...prev,
                              [entry.key]: event.target.value,
                            }))
                          }
                          aria-label={entry.key}
                        />
                      )}
                      {errors[entry.key] && <span role="alert">{errors[entry.key]}</span>}
                    </td>
                    <td>{serializeValue(entry.factoryDefault)}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            const value = parseConfigValue(
                              edits[entry.key] ?? serializeValue(entry.currentValue),
                              entry.type,
                            );
                            updateMutation.mutate({ key: entry.key, value });
                          } catch {
                            setErrors((prev) => ({
                              ...prev,
                              [entry.key]: t('tuning.invalidJson'),
                            }));
                          }
                        }}
                        aria-label={`${t('tuning.save')} ${entry.key}`}
                      >
                        {t('tuning.save')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmReset(entry.key)}
                        aria-label={`${t('tuning.reset')} ${entry.key}`}
                      >
                        {t('tuning.reset')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </details>
      ))}
      {confirmReset && (
        <div role="dialog" aria-modal="true">
          <p>{t('tuning.resetConfirm', { key: confirmReset })}</p>
          <button type="button" onClick={() => resetMutation.mutate(confirmReset)}>
            {t('tuning.confirm')}
          </button>
          <button type="button" onClick={() => setConfirmReset(null)}>
            {t('tuning.cancel')}
          </button>
        </div>
      )}
      {showImport && (
        <BundleDialog
          onClose={() => setShowImport(false)}
          onApplied={() => {
            setShowImport(false);
            void queryClient.invalidateQueries({ queryKey: ['tuning', 'config'] });
            void queryClient.invalidateQueries({ queryKey: ['tuning', 'revisions'] });
          }}
        />
      )}
    </div>
  );
}
