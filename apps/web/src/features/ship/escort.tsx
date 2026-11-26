import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateShip } from './invalidate-ship';
import { useTranslation } from 'react-i18next';
import { useIntentKey } from '../../api/intent-key';
import { client } from '../../api/client';
import type { ShipResponse, WorldResponse } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { Countdown } from '../../ui/Countdown';
import { formatDuration } from '../../ui/duration';
import { Popup } from '../../ui/Popup';

/** What the server says about the escort to a safe port (`GET /v1/ships/:id/escort`). */
export interface EscortInfo {
  state: 'available' | 'underway' | 'unavailable';
  reasons: string[];
  destinationId: string | null;
  durationSeconds: number | null;
  arrivesAt: string | null;
  nextAvailableAt: string | null;
}

/**
 * The escort to a safe port, for a pilot who cannot get out on their own (the server decides who is
 * stuck). One hook owns the query, the confirmation popup and the call, so every entry point (the
 * board's chip, the map's button) asks the same question and sends the same request.
 */
export function useEscort() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const key = useIntentKey();
  const [confirming, setConfirming] = useState(false);
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
    invalidateShip(queryClient);
  };
  const accept = useMutation({
    mutationFn: () =>
      client.post<EscortInfo>(`/v1/ships/${ship?.id ?? ''}/escort`, undefined, {
        idempotencyKey: key.keyFor(ship?.id ?? ''),
      }),
    onSuccess: () => {
      key.clear();
      setConfirming(false);
      refresh();
    },
    onError: () => setConfirming(false),
  });

  const info = ship === undefined ? undefined : escortQuery.data;
  const placeName = (id: string | null) => {
    const place = worldQuery.data?.locations.find((entry) => entry.id === id);
    return place === undefined ? (id ?? '') : pickLocalized(place.displayName, i18n.language);
  };

  const popup: ReactNode =
    info?.state === 'available' ? (
      <>
        <Popup open={confirming} title={t('escort.title')} onClose={() => setConfirming(false)}>
          <div className="stack">
            <p className="muted">
              {t('escort.body', {
                place: placeName(info.destinationId),
                time: formatDuration(info.durationSeconds ?? 0, t),
              })}
            </p>
            <p>
              {t('escort.confirm', {
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
              {t('escort.confirmAction')}
            </button>
          </div>
        </Popup>
        {accept.isError && <p className="error-text">{t('escort.failed')}</p>}
      </>
    ) : null;

  return {
    info,
    available: info?.state === 'available',
    pending: accept.isPending,
    open: () => setConfirming(true),
    popup,
    placeName,
    refresh,
  };
}

/** The map's entry: a compact button by the legend, only while the escort is on offer. */
export function EscortButton() {
  const { t } = useTranslation();
  const escort = useEscort();
  if (!escort.available) return null;
  return (
    <>
      <button
        type="button"
        className="btn tiny"
        data-testid="escort-call"
        disabled={escort.pending}
        onClick={escort.open}
      >
        {t('escort.call')}
      </button>
      {escort.popup}
    </>
  );
}

/** A slim status line while the transport flies (nothing otherwise). */
export function EscortUnderway() {
  const { t } = useTranslation();
  const escort = useEscort();
  const info = escort.info;
  if (info?.state !== 'underway') return null;
  return (
    <p className="escort-line" role="status" data-testid="escort-underway">
      <b>{t('escort.underwayTitle', { place: escort.placeName(info.destinationId) })}</b>{' '}
      <span className="muted">
        {t('escort.underwayBody')}{' '}
        {info.arrivesAt !== null && <Countdown until={info.arrivesAt} onElapsed={escort.refresh} />}
      </span>
    </p>
  );
}

/** A small line when only the weekly wait keeps the escort away: when help comes back. */
export function EscortWait() {
  const { t, i18n } = useTranslation();
  const { info } = useEscort();
  if (
    info === undefined ||
    info.reasons.length !== 1 ||
    info.reasons[0] !== 'COOLDOWN' ||
    info.nextAvailableAt === null
  ) {
    return null;
  }
  return (
    <p className="escort-line muted" role="note" data-testid="escort-wait">
      {t('escort.cooldown', {
        date: new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(info.nextAvailableAt)),
      })}
    </p>
  );
}
