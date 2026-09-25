import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { adminApi, type SupportResult } from '../admin.api';

export type SupportActionKey = 'grant' | 'remove' | 'clear' | 'unstick' | 'ban' | 'reset';

interface PendingAction {
  readonly key: SupportActionKey;
}

interface ShipOption {
  readonly id: string;
  readonly name: string;
}

interface ActionContext {
  readonly reason: string;
  readonly amount: number;
  readonly shipId: string;
}

// Screen D's support half (GDD §17). Every action opens a dialog that collects the
// operator's reason (the API rejects a request without one) and doubles as the
// confirmation step for the destructive ones — ban/reset/unstick/remove never fire
// straight from a toolbar click.
export function SupportActions({
  playerId,
  ships,
  onChanged,
}: {
  playerId: string;
  ships: ShipOption[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('1');
  const [shipId, setShipId] = useState(ships[0]?.id ?? '');

  const mutation = useMutation<SupportResult, Error, ActionContext>({
    mutationFn: async ({ reason: why, amount: value, shipId: hull }) => {
      switch (pending?.key) {
        case 'grant':
          return adminApi.grantCredits(playerId, value, why);
        case 'remove':
          return adminApi.removeCredits(playerId, value, why);
        case 'clear':
          return adminApi.clearBalance(playerId, why);
        case 'unstick':
          return adminApi.unstickShip(playerId, hull, why);
        case 'ban':
          return adminApi.banPlayer(playerId, why);
        case 'reset':
          return adminApi.resetPlayer(playerId, why);
        default:
          throw new Error('no support action selected');
      }
    },
    onSuccess: () => {
      setPending(null);
      setReason('');
      onChanged();
    },
  });

  const open = (key: SupportActionKey) => {
    setReason('');
    setAmount('1');
    setShipId(ships[0]?.id ?? '');
    mutation.reset();
    setPending({ key });
  };

  const close = () => {
    setPending(null);
    mutation.reset();
  };

  const needsAmount = pending?.key === 'grant' || pending?.key === 'remove';
  const needsShip = pending?.key === 'unstick';
  const parsedAmount = Number(amount);
  const amountValid = !needsAmount || (Number.isInteger(parsedAmount) && parsedAmount >= 1);
  const canConfirm = reason.trim() !== '' && amountValid && (!needsShip || shipId !== '');

  const submit = () => {
    if (pending === null || !canConfirm) return;
    mutation.mutate({ reason: reason.trim(), amount: parsedAmount, shipId });
  };

  const label = (key: SupportActionKey): string => t(`admin.actions.${key}`);

  return (
    <div>
      <h3>{t('admin.supportActions')}</h3>
      <div>
        <button type="button" onClick={() => open('grant')}>
          {label('grant')}
        </button>
        <button type="button" onClick={() => open('remove')}>
          {label('remove')}
        </button>
        <button type="button" onClick={() => open('clear')}>
          {label('clear')}
        </button>
        <button type="button" onClick={() => open('unstick')}>
          {label('unstick')}
        </button>
        <button type="button" onClick={() => open('ban')}>
          {label('ban')}
        </button>
        <button type="button" onClick={() => open('reset')}>
          {label('reset')}
        </button>
      </div>

      {pending !== null && (
        <div role="dialog" aria-modal="true" aria-label={label(pending.key)}>
          <h4>{label(pending.key)}</h4>
          {needsAmount && (
            <label>
              {t('admin.amount')}
              <input
                type="number"
                min={1}
                step={1}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
          )}
          {needsShip && (
            <label>
              {t('admin.ship')}
              <select value={shipId} onChange={(event) => setShipId(event.target.value)}>
                {ships.map((ship) => (
                  <option key={ship.id} value={ship.id}>
                    {ship.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            {t('admin.reasonLabel')}
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-label={t('admin.reasonLabel')}
            />
          </label>
          {mutation.isError && <p role="alert">{mutation.error.message}</p>}
          <button type="button" onClick={submit} disabled={!canConfirm || mutation.isPending}>
            {t('admin.confirmAction')}
          </button>
          <button type="button" onClick={close}>
            {t('admin.cancelAction')}
          </button>
        </div>
      )}
    </div>
  );
}
