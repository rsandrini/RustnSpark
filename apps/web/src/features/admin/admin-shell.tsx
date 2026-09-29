import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
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

const navLinkClass = ({ isActive }: { isActive: boolean }) => `nav-link${isActive ? ' on' : ''}`;

// The admin screens (S11) were built functionally with no CSS hooks of their own — every
// h2/h3/table/input/button in them is bare markup. Rather than touch a class name into each of
// the ~15 screen files, this shell wraps them in `.admin-shell` and styles/index.css skins every
// plain element under that one selector, the same way `.hangar`/`.report-story` scope their own
// screens. A per-screen layout polish (grouped filter bars, grid forms) can follow later.
export function AdminShell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const logout = useLogout();

  return (
    <div className="app wide admin-shell">
      <header className="topbar">
        <h1>{t('admin.title')}</h1>
        <div className="row-between">
          <span className="sub">{user?.name}</span>
          <button type="button" className="btn" onClick={() => logout.mutate()}>
            {t('admin.logout')}
          </button>
        </div>
      </header>
      {/* Split into two groups (owner request, round 3): read-only analytics vs. everything that
          changes game state. One flat row of ~15 links made it hard to tell "look at this" apart
          from "edit this" at a glance. */}
      <div className="admin-nav-group">
        <span className="admin-nav-label">{t('admin.navGroups.stats')}</span>
        <nav className="game-nav admin-nav" aria-label={t('admin.navGroups.stats')}>
          <NavLink to="/admin" end className={navLinkClass}>
            {t('admin.dashboard')}
          </NavLink>
          <NavLink to="/admin/analytics/economy" className={navLinkClass}>
            {t('admin.economy')}
          </NavLink>
          <NavLink to="/admin/analytics/world" className={navLinkClass}>
            {t('admin.world')}
          </NavLink>
        </nav>
      </div>
      <div className="admin-nav-group">
        <span className="admin-nav-label">{t('admin.navGroups.editable')}</span>
        <nav className="game-nav admin-nav" aria-label={t('admin.navGroups.editable')}>
          <NavLink to="/admin/players" className={navLinkClass}>
            {t('admin.players')}
          </NavLink>
          <NavLink to="/admin/system" className={navLinkClass}>
            {t('admin.system')}
          </NavLink>
          <NavLink to="/admin/tuning/config" className={navLinkClass}>
            {t('tuning.configTitle')}
          </NavLink>
          {TUNABLE_ENTITIES.map((entity) => (
            <NavLink key={entity} to={`/admin/tuning/entities/${entity}`} className={navLinkClass}>
              {t(`tuning.entityNames.${entity}`)}
            </NavLink>
          ))}
          <NavLink to="/admin/tuning/revisions" className={navLinkClass}>
            {t('tuning.revisionHistoryTitle')}
          </NavLink>
        </nav>
      </div>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
