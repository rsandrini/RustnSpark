import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import { errorText } from '../../api/errors';
import { useIntentKey } from '../../api/intent-key';
import type { RescueResponse, ShipResponse } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { Countdown } from '../../ui/Countdown';
import { FloatingPopup } from './floating-popup';
import { useAuthContext } from '../auth/auth.context';
import { useWorld } from '../ship/use-world';

type Mode = 'now' | 'wait';

/**
 * S8.6 in the UI: a ship that ran out of fuel floats in space and can do nothing until it is
 * towed to the nearest base. Two ways out: wait for the rescue (cheaper, and the price is paid
 * when it arrives) or call it now (dearer: the waiting price plus a charge for the distance to
 * that base). The prices are the server's, never computed here, and either may leave the balance
 * negative, so each sits behind a confirmation.
 */
export function RescueBanner() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { reloadProfile } = useAuthContext();
  const world = useWorld();
  const intent = useIntentKey();
  const [confirming, setConfirming] = useState<Mode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shipsQuery = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const ship = shipsQuery.data?.[0];

  const rescue = useMutation({
    mutationFn: ({ shipId, mode }: { shipId: string; mode: Mode }) =>
      client.post<RescueResponse>(
        `/v1/ships/${shipId}/rescue`,
        { mode },
        { idempotencyKey: intent.keyFor(`rescue:${shipId}:${mode}`) },
      ),
    onSuccess: (response) => {
      intent.clear();
      setConfirming(null);
      setPopupOpen(false);
      setError(null);
      setNotice(
        response.mode === 'wait'
          ? t('rescue.waitStarted')
          : t('rescue.done', { cost: response.cost, fuel: response.fuel }),
      );
      void reloadProfile();
      void queryClient.invalidateQueries({ queryKey: ['ships'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (failure) => {
      setConfirming(null);
      setPopupOpen(false);
      setError(errorText(t, failure, t('error.unexpected')));
    },
  });

  // The countdown ran out but the ship is still floating (the automatic check was early or failed): a button asks again.
  const [elapsed, setElapsed] = useState(false);
  const settle = useMutation({
    mutationFn: (shipId: string) => client.post(`/v1/ships/${shipId}/rescue/settle`),
    onSuccess: () => {
      setNotice(t('rescue.arrived'));
      void reloadProfile();
      void queryClient.invalidateQueries({ queryKey: ['ships'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (failure) => setError(errorText(t, failure, t('error.unexpected'))),
  });

  const adrift = ship?.status === 'ADRIFT';
  const options = ship?.rescue ?? null;
  const base = world.data?.locations.find((entry) => entry.id === options?.baseId);
  const baseName =
    base === undefined ? (options?.baseId ?? '') : pickLocalized(base.displayName, i18n.language);
  const waiting = options?.dueAt != null;

  // The big popup opens by itself the first time a floating ship is seen in this session; closing it leaves the bar.
  const seenKey = `rs.floating.seen.${ship?.id ?? ''}`;
  const [popupOpen, setPopupOpen] = useState(false);
  useEffect(() => {
    if (!adrift || ship === undefined) return;
    try {
      if (window.sessionStorage.getItem(seenKey) === null) setPopupOpen(true);
    } catch {
      setPopupOpen(true);
    }
    // only when the ship turns up adrift
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adrift, ship?.id]);
  const closePopup = () => {
    setPopupOpen(false);
    setConfirming(null);
    try {
      window.sessionStorage.setItem(seenKey, '1');
    } catch {
      // the popup just opens again next time
    }
  };

  return (
    <>
      {notice !== null && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error !== null && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {adrift && ship !== undefined && (
        <section className="floatbar" data-testid="rescue-banner">
          <span>
            <b>{t('rescue.title')}</b> {t('rescue.bar')}
          </span>
          {waiting && options?.dueAt != null && (
            <span className="notice" role="status" data-testid="rescue-waiting">
              {t('rescue.waiting')}{' '}
              <Countdown
                until={options.dueAt}
                onElapsed={() => {
                  setElapsed(true);
                  void queryClient.invalidateQueries({ queryKey: ['ships'] });
                }}
              />
            </span>
          )}
          {waiting && elapsed && (
            <button
              type="button"
              className="btn primary"
              data-testid="rescue-check"
              disabled={settle.isPending}
              onClick={() => settle.mutate(ship.id)}
            >
              {t('rescue.checkNow')}
            </button>
          )}
          <button type="button" className="btn primary" onClick={() => setPopupOpen(true)}>
            {t('rescue.popup.open')}
          </button>
        </section>
      )}
      {adrift && ship !== undefined && options !== null && (
        <FloatingPopup
          open={popupOpen}
          ship={ship}
          onClose={closePopup}
          rescue={options}
          baseName={baseName}
          confirming={confirming}
          onPick={setConfirming}
          onConfirm={(mode) => rescue.mutate({ shipId: ship.id, mode })}
          busy={rescue.isPending}
          onElapsed={() => {
            setElapsed(true);
            void queryClient.invalidateQueries({ queryKey: ['ships'] });
          }}
        />
      )}
    </>
  );
}
