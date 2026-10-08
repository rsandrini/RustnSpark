import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FactionArtSlot } from '../../api/generated';
import { defaultFactionBannerUrl, useFactionArt } from '../../ui/factionArt';
import { failureText } from '../../api/errors';
import { tuningApi } from './tuning.api';

const SLOTS: readonly FactionArtSlot[] = ['banner', 'logo', 'background'];
const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';

// Upload/replace/reset of a faction's images. Until an image is uploaded a slot shows the built-in
// default (today only the banner has one); "Reset to default" removes the upload again.
export function FactionArtEditor({ factionId }: { factionId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const art = useFactionArt()[factionId];
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Partial<Record<FactionArtSlot, HTMLInputElement | null>>>({});

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['factionArt'] });
  const upload = useMutation({
    mutationFn: (args: { slot: FactionArtSlot; file: File }) =>
      tuningApi.uploadFactionArt(factionId, args.slot, args.file),
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: (failure: Error) => setError(failureText(failure)),
  });
  const reset = useMutation({
    mutationFn: (slot: FactionArtSlot) => tuningApi.resetFactionArt(factionId, slot),
    onSuccess: () => {
      setError(null);
      void refresh();
    },
    onError: (failure: Error) => setError(failureText(failure)),
  });

  return (
    <section className="faction-art-editor-wrap" aria-label={t('tuning.art.title')}>
      <h3>{t('tuning.art.title')}</h3>
      <p className="muted">{t('tuning.art.help')}</p>
      {error !== null && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="faction-art-editor">
        {SLOTS.map((slot) => {
          const uploaded = art?.[slot] ?? null;
          const preview = uploaded ?? (slot === 'banner' ? defaultFactionBannerUrl(factionId) : null);
          return (
            <div key={slot} className="faction-art-slot" data-testid={`art-slot-${slot}`}>
              <b>{t(`tuning.art.slots.${slot}`)}</b>
              <small className="muted">{t(`tuning.art.slotHelp.${slot}`)}</small>
              <div className="faction-art-preview">
                {preview === null ? (
                  <span className="muted">{t('tuning.art.none')}</span>
                ) : (
                  <img src={preview} alt={t(`tuning.art.slots.${slot}`)} />
                )}
              </div>
              <small>{uploaded === null ? t('tuning.art.usingDefault') : t('tuning.art.custom')}</small>
              <input
                ref={(node) => {
                  inputs.current[slot] = node;
                }}
                type="file"
                accept={ACCEPT}
                hidden
                data-testid={`art-file-${slot}`}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file !== undefined) upload.mutate({ slot, file });
                }}
              />
              <div className="row-actions">
                <button type="button" onClick={() => inputs.current[slot]?.click()}>
                  {t('tuning.art.upload')}
                </button>
                {uploaded !== null && (
                  <button type="button" onClick={() => reset.mutate(slot)}>
                    {t('tuning.art.reset')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
