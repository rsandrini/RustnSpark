import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router-dom';
import { useAuth, useLogout } from '../auth/auth.hooks';

const TUNABLE_ENTITIES = [
  'parts',
  'materials',
  'factions',
  'locations',
  'routes',
  'environments',
  'mission-templates',
  'drop-tables',
] as const;

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
          {TUNABLE_ENTITIES.map((entity) => (
            <Link key={entity} to={`/admin/tuning/entities/${entity}`}>
              {t(`tuning.entityNames.${entity}`)}
            </Link>
          ))}
          <Link to="/admin/tuning/revisions">{t('tuning.revisionHistoryTitle')}</Link>
        </nav>
        <span>{user?.name}</span>
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
