import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useIntentKey } from '../../api/intent-key';
import { client } from '../../api/client';
import type { ShipResponse, WorldResponse } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { Countdown } from '../../ui/Countdown';
import { formatDuration } from '../../ui/duration';

/** What the server says about the escort to a safe port (`GET /v1/ships/:id/escort`). */
interface EscortInfo {
  state: 'available' | 'underway' | 'unavailable';
  reasons: string[];
  destinationId: string | null;
  durationSeconds: number | null;
  arrivesAt: string | null;
  nextAvailableAt: string | null;
}

/**
 * The way out for a stuck pilot: broke, far from the faction's ports, with a ship that cannot fly.
 * Shown only when the server offers the escort (or one is flying, or the weekly wait is the only
 * thing in the way). The pilot accepts, then watches the transport arrive; no fights, no cost.
 */
export function EscortNotice() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const key = useIntentKey();
  const shipsQuery = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const ship = shipsQuery.data?.[0];
  const worldQuery = useQuery({
    queryKey: ['world'],
    queryFn: () => client.get<WorldResponse>('/v1/locations'),
  });
  const escortQuery = useQuery({
    queryKey: ['escort', ship?.id],
    enabled: ship !== undefined && ship.status !== 'ADRIFT',
    queryFn: () => client.get<EscortInfo>(`/v1/ships/${ship?.id ?? ''}/escort`),
    refetchInterval: (query) => (query.state.data?.state === 'underway' ? 5000 : false),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['escort'] });
    void queryClient.invalidateQueries({ queryKey: ['ships'] });
    void queryClient.invalidateQueries({ queryKey: ['active'] });
  };
  const accept = useMutation({
    mutationFn: () =>
      client.post<EscortInfo>(`/v1/ships/${ship?.id ?? ''}/escort`, undefined, {
        idempotencyKey: key.keyFor(ship?.id ?? ''),
      }),
    onSuccess: () => {
      key.clear();
      refresh();
    },
  });

  const info = escortQuery.data;
  if (ship === undefined || info === undefined) return null;
  const placeName = (id: string | null) => {
    const place = worldQuery.data?.locations.find((entry) => entry.id === id);
    return place === undefined ? (id ?? '') : pickLocalized(place.displayName, i18n.language);
  };

  if (info.state === 'underway') {
    return (
      <div className="panel kit-note" role="status" data-testid="escort-underway">
        <b>{t('escort.underwayTitle', { place: placeName(info.destinationId) })}</b>
        <p className="muted">
          {t('escort.underwayBody')}{' '}
          {info.arrivesAt !== null && <Countdown until={info.arrivesAt} onElapsed={refresh} />}
        </p>
      </div>
    );
  }
  if (info.state === 'available') {
    return (
      <div className="panel kit-note" role="note" data-testid="escort-offer">
        <b>{t('escort.title')}</b>
        <p className="muted">
          {t('escort.body', {
            place: placeName(info.destinationId),
            time: formatDuration(info.durationSeconds ?? 0, t),
          })}
        </p>
        <button
          type="button"
          className="btn primary"
          disabled={accept.isPending}
          onClick={() => accept.mutate()}
        >
          {t('escort.accept')}
        </button>
        {accept.isError && <p className="error-text">{t('escort.failed')}</p>}
      </div>
    );
  }
  // Only the weekly wait is in the way: say when help comes back, so the pilot is not left guessing.
  if (
    info.reasons.length === 1 &&
    info.reasons[0] === 'COOLDOWN' &&
    info.nextAvailableAt !== null
  ) {
    return (
      <div className="panel kit-note" role="note" data-testid="escort-wait">
        <p className="muted">
          {t('escort.cooldown', {
            date: new Intl.DateTimeFormat(i18n.language, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(info.nextAvailableAt)),
          })}
        </p>
      </div>
    );
  }
  return null;
}
