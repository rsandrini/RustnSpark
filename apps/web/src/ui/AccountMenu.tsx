import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth, useLogout } from '../features/auth/auth.hooks';

/**
 * Top-right account menu (Profile / Admin / Logout), replacing the old "Profile" nav-bar link
 * and the Home screen's own logout button (Home is gone — every in-game screen needs a way to
 * reach these now). Admin only shows for an ADMIN account.
 */
export function AccountMenu() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const logout = useLogout();

  return (
    <div className="account-menu">
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
