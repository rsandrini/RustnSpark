import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { tuningApi } from './tuning.api';
import type * as dto from '../../api/generated';

interface BundleDialogProps {
  onClose: () => void;
  onApplied: () => void;
}

export function BundleDialog({ onClose, onApplied }: BundleDialogProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [diffs, setDiffs] = useState<dto.BundleDiff[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dryRunMutation = useMutation({
    mutationFn: (entries: dto.BundleExportEntry[]) => tuningApi.dryRunBundle(entries),
    onSuccess: (result) => {
      setDiffs(result.diffs);
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
      setDiffs(null);
    },
  });

  const applyMutation = useMutation({
    mutationFn: (entries: dto.BundleExportEntry[]) => tuningApi.importBundle(entries),
    onSuccess: () => {
      onApplied();
    },
    onError: (err: Error) => setError(err.message),
  });

  const parseEntries = (): dto.BundleExportEntry[] => {
    const parsed = JSON.parse(text) as dto.BundleExport | dto.BundleExportEntry[];
    if (Array.isArray(parsed)) return parsed;
    return parsed.entries;
  };

  const handleDryRun = () => {
    try {
      const entries = parseEntries();
      dryRunMutation.mutate(entries);
    } catch {
      setError(t('tuning.invalidBundle'));
    }
  };

  const handleApply = () => {
    try {
      const entries = parseEntries();
      applyMutation.mutate(entries);
    } catch {
      setError(t('tuning.invalidBundle'));
    }
  };

  const handleFile = async (file: File) => {
    const content = await file.text();
    setText(content);
  };

  return (
    <div role="dialog" aria-modal="true">
      <h3>{t('tuning.importBundle')}</h3>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={10}
        placeholder={t('tuning.pasteBundle')}
        aria-label={t('tuning.bundleJson')}
      />
      <input
        type="file"
        accept="application/json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {error && <p role="alert">{error}</p>}
      {diffs && (
        <div>
          <h4>{t('tuning.diffPreview')}</h4>
          <ul>
            {diffs.map((diff) => (
              <li key={diff.key}>
                {t('tuning.diffItem', {
                  key: diff.key,
                  before: JSON.stringify(diff.before),
                  after: JSON.stringify(diff.after),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <button type="button" onClick={handleDryRun}>
          {t('tuning.dryRun')}
        </button>
        {diffs && (
          <button type="button" onClick={handleApply}>
            {t('tuning.apply')}
          </button>
        )}
        <button type="button" onClick={onClose}>
          {t('tuning.cancel')}
        </button>
      </div>
    </div>
  );
}
