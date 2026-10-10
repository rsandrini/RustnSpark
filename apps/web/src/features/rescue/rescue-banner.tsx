import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import { errorText } from '../../api/errors';
import { useIntentKey } from '../../api/intent-key';
import type { RescueResponse, ShipResponse } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { Countdown } from '../../ui/Countdown';
import { Popup } from '../../ui/Popup';
import { useAuthContext } from '../auth/auth.context';
import { useWorld } from '../ship/use-world';

type Mode = 'now' | 'wait';

const SECONDS_PER_MINUTE = 60;

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
      setError(errorText(t, failure, t('error.unexpected')));
    },
  });

  const adrift = ship?.status === 'ADRIFT';
  const options = ship?.rescue ?? null;
  const base = world.data?.locations.find((entry) => entry.id === options?.baseId);
  const baseName =
    base === undefined ? (options?.baseId ?? '') : pickLocalized(base.displayName, i18n.language);
  const waiting = options?.dueAt != null;

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
        <section className="stack rescue" data-testid="rescue-banner">
          <h2>{t('rescue.title')}</h2>
          <p>{t('rescue.body')}</p>
          {options !== null && (
            <p className="sub">
              {t('rescue.nearestBase', { base: baseName, distance: options.baseDistance })}
            </p>
          )}
          {waiting && options?.dueAt != null && (
            <p className="notice" role="status" data-testid="rescue-waiting">
              {t('rescue.waiting')}{' '}
              <Countdown
                until={options.dueAt}
                onElapsed={() => void queryClient.invalidateQueries({ queryKey: ['ships'] })}
              />
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={rescue.isPending || waiting || options === null}
              onClick={() => setConfirming('wait')}
            >
              {t('rescue.wait', {
                cost: options?.waitCost ?? 0,
                minutes: Math.max(1, Math.round((options?.waitSeconds ?? 0) / SECONDS_PER_MINUTE)),
              })}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={rescue.isPending || options === null}
              onClick={() => setConfirming('now')}
            >
              {t('rescue.now', { cost: options?.nowCost ?? 0 })}
            </button>
          </div>
          <Popup
            open={confirming !== null}
            title={t('rescue.title')}
            onClose={() => setConfirming(null)}
          >
            {confirming !== null && options !== null && (
              <div className="stack">
                <p>
                  {confirming === 'wait'
                    ? t('rescue.confirmWait', {
                        cost: options.waitCost,
                        base: baseName,
                        minutes: Math.max(1, Math.round(options.waitSeconds / SECONDS_PER_MINUTE)),
                      })
                    : t('rescue.confirmNow', { cost: options.nowCost, base: baseName })}
                </p>
                <button
                  type="button"
                  className="btn primary"
                  disabled={rescue.isPending}
                  onClick={() => rescue.mutate({ shipId: ship.id, mode: confirming })}
                >
                  {confirming === 'wait' ? t('rescue.waitAction') : t('rescue.nowAction')}
                </button>
              </div>
            )}
          </Popup>
        </section>
      )}
    </>
  );
}
