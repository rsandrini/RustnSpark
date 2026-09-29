import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router';
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

interface AdminNavItem {
  readonly to: string;
  readonly end?: boolean;
  readonly label: string;
}

interface AdminNavDropdownProps {
  readonly id: string;
  readonly label: string;
  readonly items: readonly AdminNavItem[];
}

// Round-5 owner follow-up to the Stats/Editable split: "make STATS a menu that opens the sub
// ones, and aside the manageable as open the sub ones related" — two permanently-expanded rows
// read as a "double menu"; this collapses each into one click-to-open button instead. Plain
// disclosure (aria-expanded/aria-controls revealing ordinary links), not the WAI-ARIA menu-button
// pattern: these are real navigation links, not commands, and there's no arrow-key/roving-
// tabindex support here to back up the stronger "menu" promise that role="menu"/"menuitem" would
// make to a screen reader. Nothing like even this simpler version exists yet in this codebase —
// `Popup` is a centered modal with a backdrop, not an anchored flyout.
function AdminNavDropdown({ id, label, items }: AdminNavDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = `admin-nav-panel-${id}`;
  const location = useLocation();
  const isActive = items.some((item) =>
    item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
  );

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current !== null && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="admin-nav-dropdown" ref={containerRef}>
      <button
        type="button"
        className={`nav-link admin-nav-trigger${isActive ? ' on' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        {label}
      </button>
      {open && (
        <div className="admin-nav-panel" id={panelId} aria-label={label}>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={navLinkClass}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

// The admin screens (S11) were built functionally with no CSS hooks of their own — every
// h2/h3/table/input/button in them is bare markup. Rather than touch a class name into each of
// the ~15 screen files, this shell wraps them in `.admin-shell` and styles/index.css skins every
// plain element under that one selector, the same way `.hangar`/`.report-story` scope their own
// screens. A per-screen layout polish (grouped filter bars, grid forms) can follow later.
export function AdminShell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const logout = useLogout();

  const statsItems: AdminNavItem[] = [
    { to: '/admin', end: true, label: t('admin.dashboard') },
    { to: '/admin/analytics/economy', label: t('admin.economy') },
    { to: '/admin/analytics/world', label: t('admin.world') },
  ];
  const editableItems: AdminNavItem[] = [
    { to: '/admin/players', label: t('admin.players') },
    { to: '/admin/system', label: t('admin.system') },
    { to: '/admin/tuning/config', label: t('tuning.configTitle') },
    ...TUNABLE_ENTITIES.map((entity) => ({
      to: `/admin/tuning/entities/${entity}`,
      label: t(`tuning.entityNames.${entity}`),
    })),
    { to: '/admin/tuning/revisions', label: t('tuning.revisionHistoryTitle') },
  ];

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
          changes game state — each its own click-to-open menu (round 5), not a permanently
          expanded row. */}
      <nav className="game-nav admin-nav" aria-label={t('admin.title')}>
        <AdminNavDropdown id="stats" label={t('admin.navGroups.stats')} items={statsItems} />
        <AdminNavDropdown id="editable" label={t('admin.navGroups.editable')} items={editableItems} />
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
