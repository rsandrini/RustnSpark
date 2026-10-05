import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';

// Owner request: Port and Board are reachable straight from the top nav again (reversing the
// round-3 fold into gated My Ship tabs) — the hangar's own tab row still has them too, this is
// an additional way in, not a replacement. `end` on My Ship keeps it from reading "active" on
// /hangar/port or /hangar/board, which also start with /hangar. Profile/Admin/Logout still live
// in the top-right AccountMenu instead.
const GAME_LINKS = [
  { id: 'hangar', to: '/hangar', end: true },
  { id: 'port', to: '/hangar/port', end: false },
  { id: 'board', to: '/hangar/board', end: false },
  { id: 'map', to: '/map', end: false },
] as const;

// Persistent game loop nav (S10.10): My Ship reaches everything else from one screen now.
export function GameNav() {
  const { t } = useTranslation();
  return (
    <nav className="game-nav" aria-label={t('nav.label')}>
      {GAME_LINKS.map(({ id, to, end }) => (
        <NavLink
          key={id}
          to={to}
          end={end}
          className={({ isActive }) => `nav-link${isActive ? ' on' : ''}`}
        >
          {t(`nav.${id}`)}
        </NavLink>
      ))}
    </nav>
  );
}
