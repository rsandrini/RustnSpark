import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const GAME_LINKS = ['hangar', 'map', 'board', 'transit', 'port', 'profile'] as const;

// Persistent game loop nav (S10.10): every in-game screen reaches every other one,
// so the Hangar → Map → Board → Transit → Report → Port loop has no dead ends.
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
