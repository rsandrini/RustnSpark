import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../api/client';
import { Popup } from '../../ui/Popup';
import { useAuthContext } from './auth.context';

interface ClaimPopupProps {
  open: boolean;
  onClose: () => void;
}

/** A guest saves the pilot with an email and password (and, if they like, a pilot name). */
export function ClaimPopup({ open, onClose }: ClaimPopupProps) {
  const { t } = useTranslation();
  const { claimPilot } = useAuthContext();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const claim = useMutation({
    mutationFn: () =>
      claimPilot({ email, password, ...(name.trim() === '' ? {} : { name: name.trim() }) }),
    onSuccess: onClose,
  });
  const error = claim.error;
  const errorKey =
    error instanceof ApiError
      ? error.status === 409
        ? 'register.error.conflict'
        : error.status === 400
          ? 'register.error.invalid'
          : error.status === 429
            ? 'error.RATE_LIMITED'
            : 'guest.claim.error'
      : 'guest.claim.error';

  return (
    <Popup open={open} title={t('guest.claim.title')} onClose={onClose}>
      <p>{t('guest.claim.text')}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          claim.mutate();
        }}
      >
        <div className="field">
          <label className="lbl" htmlFor="claim-email">
            {t('register.emailLabel')}
          </label>
          <input
            className="input"
            id="claim-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div className="field">
          <label className="lbl" htmlFor="claim-password">
            {t('register.passwordLabel')}
          </label>
          <input
            className="input"
            id="claim-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={6}
            maxLength={128}
            autoComplete="new-password"
          />
          <p className="sub help-text">{t('register.passwordHint')}</p>
        </div>
        <div className="field">
          <label className="lbl" htmlFor="claim-name">
            {t('guest.claim.nameLabel')}
          </label>
          <input
            className="input"
            id="claim-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={3}
            maxLength={24}
            pattern="[A-Za-z0-9_\-]+"
            autoComplete="nickname"
          />
          <p className="sub help-text">{t('guest.claim.nameHint')}</p>
        </div>
        <button className="btn primary block" type="submit" disabled={claim.isPending}>
          {t('guest.claim.submit')}
        </button>
        {claim.isError && (
          <p className="error-text" role="alert">
            {t(errorKey)}
          </p>
        )}
      </form>
    </Popup>
  );
}
