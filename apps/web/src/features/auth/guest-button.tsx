import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import { useAuthContext } from './auth.context';
import { HelpTip } from '../../ui/kit/HelpTip';

/** "Play as guest": a pilot with no email and no password, kept by this browser. */
export function GuestButton() {
  const { t } = useTranslation();
  const { playAsGuest } = useAuthContext();
  const start = useMutation({ mutationFn: playAsGuest });
  const code = start.error instanceof ApiError ? start.error.code : undefined;
  const errorKey =
    start.error instanceof ApiError && start.error.status === 429
      ? 'error.RATE_LIMITED'
      : code !== undefined && code.startsWith('GUEST_')
        ? `error.${code}`
        : code === 'REGISTRATION_CLOSED'
          ? 'error.REGISTRATION_CLOSED'
          : 'guest.error.generic';

  return (
    <div className="guest-start">
      <div className="help-row">
        <button
          type="button"
          className="btn block"
          disabled={start.isPending}
          onClick={() => start.mutate()}
        >
          {t('guest.play')}
        </button>
        <HelpTip align="end">{t('guest.playHint')}</HelpTip>
      </div>
      {start.isError && (
        <p className="error-text" role="alert">
          {t(errorKey)}
        </p>
      )}
    </div>
  );
}
