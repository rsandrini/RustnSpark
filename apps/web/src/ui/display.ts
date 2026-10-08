import { useQuery } from '@tanstack/react-query';
import { client } from '../api/client';
import type { DisplayResponse, ShipSheet } from '../api/generated';

// What the game ships with; used until (or unless) the server answers, so numbers never flash raw.
const DEFAULT_DISPLAY: DisplayResponse = { statScale: 10, mobFactor: 1.6 };

/** How derived numbers are shown, as tuned in the admin (`ship.stat_display_scale`). */
export function useDisplay(): DisplayResponse {
  const query = useQuery({
    queryKey: ['display'],
    queryFn: () => client.get<DisplayResponse>('/v1/display'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return query.data ?? DEFAULT_DISPLAY;
}

/** A speed in game units (race rivals, mission requirements) as the player reads it. */
export function scaleSpeed(raw: number, display: DisplayResponse): number {
  return raw * display.statScale;
}

/**
 * The player-facing value of one sheet stat. Mobility is shown from the unrounded pot/mass figure
 * (a ship with no engine reads 0, not the game's floor of 1) times the display scale, so every
 * part added or removed moves it visibly; all other stats are shown as they are.
 */
export function sheetStat(
  sheet: Pick<ShipSheet, keyof ShipSheet>,
  key: keyof ShipSheet,
  display: DisplayResponse,
): number {
  if (key !== 'mob') return sheet[key];
  const raw = sheet.mass > 0 ? (sheet.pot / sheet.mass) * display.mobFactor : 0;
  return scaleSpeed(raw, display);
}
