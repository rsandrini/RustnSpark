import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { errorText } from '../../api/errors';
import { useIntentKey } from '../../api/intent-key';
import { Popup } from '../../ui/Popup';
import { adminApi, type SupportResult } from '../admin.api';

const MAX_AMOUNT = 1_000_000_000;
const MAX_REASON = 500;
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 128;

export type SupportActionKey =
  | 'grant'
  | 'remove'
  | 'clear'
  | 'password'
  | 'unstick'
  | 'ban'
  | 'reset'
  | 'fastOps';

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
  readonly password: string;
}

// Screen D's support half (GDD §17). Every action opens a dialog that collects the
// operator's reason (the API rejects a request without one) and doubles as the
// confirmation step for the destructive ones — ban/reset/unstick/remove never fire
// straight from a toolbar click.
export function SupportActions({
  playerId,
  ships,
  fastOpsOn,
  onChanged,
}: {
  playerId: string;
  ships: ShipOption[];
  /** The player's current fast-missions switch (what the button will flip). */
  fastOpsOn: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const intent = useIntentKey();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('1');
  const [shipId, setShipId] = useState(ships[0]?.id ?? '');
  const [password, setPassword] = useState('');

  const mutation = useMutation<SupportResult, Error, ActionContext>({
    mutationFn: async ({ reason: why, amount: value, shipId: hull, password: pass }) => {
      // Same intent (action + target + inputs) keeps the same key across retries.
      const key = intent.keyFor(`${pending?.key}:${playerId}:${hull}:${value}:${pass}:${why}`);
      switch (pending?.key) {
        case 'grant':
          return adminApi.grantCredits(playerId, value, why, key);
        case 'remove':
          return adminApi.removeCredits(playerId, value, why, key);
        case 'clear':
          return adminApi.clearBalance(playerId, why, key);
        case 'password':
          return adminApi.setPassword(playerId, pass, why, key);
        case 'unstick':
          return adminApi.unstickShip(playerId, hull, why, key);
        case 'ban':
          return adminApi.banPlayer(playerId, why, key);
        case 'reset':
          return adminApi.resetPlayer(playerId, why, key);
        case 'fastOps':
          return adminApi.setDebugFastOps(playerId, !fastOpsOn, why, key);
        default:
          throw new Error('no support action selected');
      }
    },
    onSuccess: () => {
      intent.clear();
      setPending(null);
      setReason('');
      onChanged();
    },
  });

  const open = (key: SupportActionKey) => {
    setReason('');
    setAmount('1');
    setShipId(ships[0]?.id ?? '');
    setPassword('');
    mutation.reset();
    setPending({ key });
  };

  const close = () => {
    setPending(null);
    mutation.reset();
  };

  const needsAmount = pending?.key === 'grant' || pending?.key === 'remove';
  const needsShip = pending?.key === 'unstick';
  const needsPassword = pending?.key === 'password';
  const parsedAmount = Number(amount);
  const amountValid =
    !needsAmount ||
    (Number.isInteger(parsedAmount) && parsedAmount >= 1 && parsedAmount <= MAX_AMOUNT);
  const passwordValid =
    !needsPassword || (password.length >= MIN_PASSWORD && password.length <= MAX_PASSWORD);
  const canConfirm =
    reason.trim() !== '' && amountValid && passwordValid && (!needsShip || shipId !== '');

  const submit = () => {
    if (pending === null || !canConfirm) return;
    mutation.mutate({ reason: reason.trim(), amount: parsedAmount, shipId, password });
  };

  const destructive = pending?.key === 'ban' || pending?.key === 'reset';
  const label = (key: SupportActionKey): string =>
    key === 'fastOps' && fastOpsOn ? t('admin.actions.fastOpsOff') : t(`admin.actions.${key}`);

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
        <button type="button" onClick={() => open('password')}>
          {label('password')}
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
        <button type="button" onClick={() => open('fastOps')} aria-pressed={fastOpsOn}>
          {fastOpsOn ? t('admin.actions.fastOpsOff') : t('admin.actions.fastOps')}
        </button>
      </div>

      <Popup
        open={pending !== null}
        title={pending !== null ? label(pending.key) : ''}
        onClose={close}
        actions={
          <>
            <button
              type="button"
              className="btn"
              onClick={submit}
              disabled={!canConfirm || mutation.isPending}
            >
              {t('admin.confirmAction')}
            </button>
            <button type="button" className="btn" onClick={close}>
              {t('admin.cancelAction')}
            </button>
          </>
        }
      >
        {pending !== null && (
          <>
            <p className={destructive ? 'error-text' : undefined}>
              {t(`admin.warnings.${pending.key}`)}
            </p>
            {needsAmount && (
              <label>
                {t('admin.amount')}
                <input
                  type="number"
                  min={1}
                  max={MAX_AMOUNT}
                  step={1}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
            )}
            {needsPassword && (
              <>
                <label>
                  {t('admin.newPassword')}
                  <input
                    type="text"
                    minLength={MIN_PASSWORD}
                    maxLength={MAX_PASSWORD}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <p className="sub">{t('admin.newPasswordHint')}</p>
              </>
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
                maxLength={MAX_REASON}
                onChange={(event) => setReason(event.target.value)}
                aria-label={t('admin.reasonLabel')}
              />
            </label>
            {mutation.isError && (
              <p role="alert" className="error-text">
                {errorText(t, mutation.error, t('error.unexpected'))}
              </p>
            )}
          </>
        )}
      </Popup>
    </div>
  );
}
