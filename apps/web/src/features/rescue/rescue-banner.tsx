import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import { errorText } from '../../api/errors';
import { useIntentKey } from '../../api/intent-key';
import type { RescueResponse, ShipResponse } from '../../api/generated';
import { Popup } from '../../ui/Popup';
import { useAuthContext } from '../auth/auth.context';

/**
 * S8.6 in the UI: a ship that ran out of fuel is ADRIFT and can do nothing until it is
 * towed. The tow costs a flat server-side fee (never shown from client data — the client
 * holds no rules) and may leave the balance negative, so it sits behind a confirmation.
 */
export function RescueBanner() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { reloadProfile } = useAuthContext();
  const intent = useIntentKey();
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shipsQuery = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const ship = shipsQuery.data?.[0];

  const rescue = useMutation({
    mutationFn: (shipId: string) =>
      client.post<RescueResponse>(`/v1/ships/${shipId}/rescue`, undefined, {
        idempotencyKey: intent.keyFor(`rescue:${shipId}`),
      }),
    onSuccess: (response) => {
      intent.clear();
      setConfirming(false);
      setError(null);
      setNotice(t('rescue.done', { cost: response.cost, fuel: response.fuel }));
      void reloadProfile();
      void queryClient.invalidateQueries({ queryKey: ['ships'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (failure) => {
      setConfirming(false);
      setError(errorText(t, failure, t('error.unexpected')));
    },
  });

  const adrift = ship?.status === 'ADRIFT';

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
          <button
            type="button"
            className="btn primary"
            disabled={rescue.isPending}
            onClick={() => setConfirming(true)}
          >
            {t('rescue.action')}
          </button>
          <Popup open={confirming} title={t('rescue.title')} onClose={() => setConfirming(false)}>
            <div className="stack">
              <p>{t('rescue.body')}</p>
              <button
                type="button"
                className="btn primary"
                disabled={rescue.isPending}
                onClick={() => rescue.mutate(ship.id)}
              >
                {t('rescue.action')}
              </button>
            </div>
          </Popup>
        </section>
      )}
    </>
  );
}
