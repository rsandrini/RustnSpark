import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { defaultFactionBannerUrl, useFactionArt } from '../../ui/factionArt';
import { placeArtUrl, usePlaceArt } from '../../ui/PlaceArt';
import { failureText } from '../../api/errors';
import { tuningApi } from './tuning.api';

export type ArtKind = 'factions' | 'locations' | 'quest-givers';

const SLOTS: Record<ArtKind, readonly string[]> = {
  factions: ['banner', 'logo', 'background'],
  locations: ['wide', 'square', 'icon'],
  // The giver's face on the board, transit, report and tutorial card (plan §7).
  'quest-givers': ['portrait'],
};
const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';

// Upload/replace/reset of an entity's images (a faction's banner/logo/background, a place's
// wide/square/icon, a giver's portrait). Until an image is uploaded a slot shows the built-in
// default (where there is one); "Reset to default" removes the upload again. Giver portraits
// have no public listing endpoint, so their preview keeps the last upload of this session.
export function ArtEditor({ kind, id }: { kind: ArtKind; id: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const factionArt = useFactionArt();
  const placeArt = usePlaceArt();
  const [giverArt, setGiverArt] = useState<Record<string, string | null>>({});
  const uploaded: Record<string, string | null> | undefined =
    kind === 'factions' ? factionArt[id] : kind === 'locations' ? placeArt[id] : giverArt;
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: [kind === 'factions' ? 'factionArt' : 'placeArt'] });
  const upload = useMutation({
    mutationFn: (args: { slot: string; file: File }) =>
      tuningApi.uploadArt(kind, id, args.slot, args.file),
    onSuccess: (change, args) => {
      setError(null);
      if (kind === 'quest-givers') setGiverArt((prev) => ({ ...prev, [args.slot]: change.url }));
      else void refresh();
    },
    onError: (failure: Error) => setError(failureText(failure)),
  });
  const reset = useMutation({
    mutationFn: (slot: string) => tuningApi.resetArt(kind, id, slot),
    onSuccess: (_change, slot) => {
      setError(null);
      if (kind === 'quest-givers') setGiverArt((prev) => ({ ...prev, [slot]: null }));
      else void refresh();
    },
    onError: (failure: Error) => setError(failureText(failure)),
  });

  const defaultOf = (slot: string): string | null => {
    if (kind === 'locations') return placeArtUrl(id, slot as 'wide' | 'square' | 'icon');
    if (kind === 'quest-givers') return null;
    return slot === 'banner' ? defaultFactionBannerUrl(id) : null;
  };

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
        {SLOTS[kind].map((slot) => {
          const custom = uploaded?.[slot] ?? null;
          const preview = custom ?? defaultOf(slot);
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
              <small>
                {custom === null ? t('tuning.art.usingDefault') : t('tuning.art.custom')}
              </small>
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
                {custom !== null && (
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
