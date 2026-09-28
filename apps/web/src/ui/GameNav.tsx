import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useActiveMissions } from '../features/transit/use-active-mission';

// Profile/Admin/Logout live in the top-right AccountMenu instead (round-3 nav consolidation).
const GAME_LINKS = ['hangar', 'map', 'board', 'transit', 'port'] as const;
// Board/Port/Transit still route independently for now (round-3's tab-count reduction — folding
// them into My Ship with ship-status gating — is a separate follow-up); this only moves Profile.

// Persistent game loop nav (S10.10): every in-game screen reaches every other one,
// so the Hangar → Map → Board → Transit → Report → Port loop has no dead ends.
export function GameNav() {
  const { t } = useTranslation();
  const active = useActiveMissions();
  // Transit only has something to show while there is a mission to dispatch, watch or read about;
  // docked in a port with nothing under way, the entry would be a dead screen.
  const hasMission = (active.data ?? []).length > 0;
  return (
    <nav className="game-nav" aria-label={t('nav.label')}>
      {GAME_LINKS.map((id) =>
        id === 'transit' && !hasMission ? (
          <span
            key={id}
            className="nav-link disabled"
            aria-disabled="true"
            title={t('nav.transitDisabled')}
          >
            {t(`nav.${id}`)}
          </span>
        ) : (
          <NavLink
            key={id}
            to={`/${id}`}
            className={({ isActive }) => `nav-link${isActive ? ' on' : ''}`}
          >
            {t(`nav.${id}`)}
          </NavLink>
        ),
      )}
    </nav>
  );
}
