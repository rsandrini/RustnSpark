import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';

// Board, Port and Transit folded into My Ship as gated tabs/sections (round-3 nav
// consolidation); Profile/Admin/Logout live in the top-right AccountMenu instead.
const GAME_LINKS = ['hangar', 'map'] as const;

// Persistent game loop nav (S10.10): My Ship reaches everything else from one screen now.
export function GameNav() {
  const { t } = useTranslation();
  return (
    <nav className="game-nav" aria-label={t('nav.label')}>
      {GAME_LINKS.map((id) => (
        <NavLink
          key={id}
          to={`/${id}`}
          className={({ isActive }) => `nav-link${isActive ? ' on' : ''}`}
        >
          {t(`nav.${id}`)}
        </NavLink>
      ))}
    </nav>
  );
}
