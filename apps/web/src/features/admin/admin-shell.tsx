import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router-dom';
import { useAuth, useLogout } from '../auth/auth.hooks';

export function AdminShell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const logout = useLogout();

  return (
    <div>
      <header>
        <h1>{t('admin.title')}</h1>
        <nav aria-label={t('admin.navigation')}>
          <Link to="/admin/tuning/config">{t('tuning.configTitle')}</Link>
          <Link to="/admin/tuning/entities/materials">{t('tuning.entities')}</Link>
          <Link to="/admin/tuning/revisions">{t('tuning.revisionHistoryTitle')}</Link>
        </nav>
        <span>{user?.email}</span>
        <button type="button" onClick={() => logout.mutate()}>
          {t('admin.logout')}
        </button>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
