import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth, useLogout } from '../features/auth/auth.hooks';

/**
 * Top-right account menu (wallet / Profile / Admin / Logout), replacing the old "Profile"
 * nav-bar link and the Home screen's own logout button (Home is gone — every in-game screen
 * needs a way to reach these now). Admin only shows for an ADMIN account. The wallet used to
 * be its own line on My Ship's header; it lives here now so that page has fewer lines and the
 * balance is visible everywhere, not just there.
 */
export function AccountMenu() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const logout = useLogout();
  const credits = `${new Intl.NumberFormat(i18n.language).format(user?.credits ?? 0)} ¢`;

  return (
    <div className="account-menu">
      <span className="wallet-chip" data-testid="topbar-wallet" aria-label={t('port.wallet')}>
        {credits}
      </span>
      <Link className="nav-link" to="/profile">
        {t('nav.profile')}
      </Link>
      {user?.role === 'ADMIN' && (
        <Link className="nav-link" to="/admin">
          {t('nav.admin')}
        </Link>
      )}
      <button type="button" className="btn tiny" onClick={() => logout.mutate()}>
        {t('nav.logout')}
      </button>
    </div>
  );
}
