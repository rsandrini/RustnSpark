import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { authApi } from '../features/auth/auth.api';
import { useAuthContext } from '../features/auth/auth.context';
import { useAuth, useLogout } from '../features/auth/auth.hooks';
import { LanguageSwitcher } from '../i18n/language-switcher';

/** Two letters for the avatar button: the pilot's initials, never empty. */
function initialsOf(name: string | undefined): string {
  const parts = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter((part) => part !== '');
  const letters =
    parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : (parts[0] ?? '').slice(0, 2);
  return letters === '' ? '··' : letters.toUpperCase();
}

/**
 * The top-right account area: the wallet (always visible, it is the number a pilot checks most) and
 * an avatar button that opens a small menu: Profile, Admin (admin accounts only), the language and
 * Sign out. The menu closes on Escape, on a click outside and when a link in it is followed.
 */
export function AccountMenu() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { reloadProfile } = useAuthContext();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const credits = `${new Intl.NumberFormat(i18n.language).format(user?.credits ?? 0)} ¢`;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  return (
    <div className="shell-account" ref={root}>
      <span className="wallet-chip" data-testid="topbar-wallet" aria-label={t('port.wallet')}>
        {credits}
      </span>
      <button
        type="button"
        className="avatar"
        aria-expanded={open}
        aria-controls="account-menu"
        aria-label={t('nav.account')}
        onClick={() => setOpen((was) => !was)}
      >
        {initialsOf(user?.name)}
      </button>
      {open && (
        <div className="shell-menu" id="account-menu">
          <div className="label shell-menu-name">{user?.name}</div>
          <Link className="shell-menu-item" to="/profile" onClick={() => setOpen(false)}>
            {t('nav.profile')}
          </Link>
          <Link className="shell-menu-item" to="/guide" onClick={() => setOpen(false)}>
            {t('nav.guide')}
          </Link>
          {user?.tutorialDone === true && (
            <button
              type="button"
              className="shell-menu-item"
              onClick={() => {
                setOpen(false);
                void authApi.setTutorialDone(false).then(() => reloadProfile());
              }}
            >
              {t('nav.gettingStarted')}
            </button>
          )}
          {user?.role === 'ADMIN' && (
            <Link className="shell-menu-item" to="/admin" onClick={() => setOpen(false)}>
              {t('nav.admin')}
            </Link>
          )}
          <div className="shell-menu-lang">
            <LanguageSwitcher />
          </div>
          <button type="button" className="shell-menu-item" onClick={() => logout.mutate()}>
            {t('nav.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
