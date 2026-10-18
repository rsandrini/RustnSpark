import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { client } from '../api/client';
import type { ShipResponse } from '../api/generated';

// The game's four places, in this order: Ship, Port, Missions, Map (phase 2 of the redesign). The
// ids are the i18n keys under `nav.*` ("hangar" is the Ship, "board" the Missions); the paths are
// the real routes — the old /hangar and /board paths only redirect. Profile, Admin, language and
// Sign out live in the account menu at the right of the top bar.
const GAME_LINKS = [
  { id: 'hangar', to: '/ship', icon: 'M3 12l5-6h8l5 6-5 6H8z M12 10v4 M10 12h4' },
  { id: 'port', to: '/port', icon: 'M4 20V10l8-6 8 6v10z M9 20v-6h6v6' },
  { id: 'board', to: '/missions', icon: 'M5 4h14v16H5z M9 9h6 M9 13h6 M9 17h3' },
  { id: 'map', to: '/map', icon: 'M6 8h.01 M18 6h.01 M14 18h.01 M8 8l8-2 M7 10l6 7 M17 8l-3 9' },
] as const;

/**
 * The persistent game nav. In the top bar it is a row of text links; on a phone the same links are
 * rendered as a fixed bottom tab bar (`bar`), each with its icon above the label.
 */
export function GameNav({ bar = false }: { bar?: boolean }) {
  const { t } = useTranslation();
  // The Port and Missions need the ship at rest in a port; while it travels or works the pilot is
  // sent back to the Ship screen, so those two are shown off instead of bouncing the pilot back.
  const ships = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const ship = ships.data?.[0];
  const away = ship !== undefined && ship.status !== 'IN_PORT';
  return (
    <nav className={bar ? 'shell-tabbar' : 'shell-nav'} aria-label={t('nav.label')}>
      {GAME_LINKS.map(({ id, to, icon }) => {
        const mark = (
          <svg
            className="nav-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d={icon} />
          </svg>
        );
        if (away && (id === 'port' || id === 'board')) {
          return (
            <span key={id} className="nav-link disabled" aria-disabled="true" title={t('nav.busy')}>
              {mark}
              <span>{t(`nav.${id}`)}</span>
            </span>
          );
        }
        return (
          <NavLink
            key={id}
            to={to}
            className={({ isActive }) => `nav-link${isActive ? ' on' : ''}`}
          >
            {mark}
            <span>{t(`nav.${id}`)}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
