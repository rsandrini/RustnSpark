import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../api/client';
import type { ShipResponse } from '../api/generated';
import { useAuth } from '../features/auth/auth.hooks';
import { useRescueSettle } from '../features/rescue/use-rescue-settle';
import { useWorld } from '../features/ship/use-world';
import { pickLocalized } from '../i18n/localized';
import { Countdown } from './Countdown';
import { FactionBadge } from './FactionBadge';
import { LastMissionLink } from './LastMissionLink';

/** Between the status text and its countdown. */
const STATUS_SEPARATOR = ' · ';

// A ship always has a name (the server assigns a starter one), but a placeholder still guards
// against an unexpected blank — a short, stable hex tag derived from the ship's id, not a
// different random value on every render.
export function hexPlaceholder(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (Math.imul(hash, 31) + seed.charCodeAt(index)) >>> 0;
  }
  return (hash % 0xffffff).toString(16).padStart(6, '0').toUpperCase();
}

/**
 * The status strip under the top bar: faction, ship name and what the ship is doing now (with the
 * countdown while a job or flight runs), and the link to the last mission's report at the right.
 * Visible from every in-game screen so the body can stay clean.
 */
export function StatusStrip() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { t, i18n } = useTranslation();
  const world = useWorld();
  const shipsQuery = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const ship = shipsQuery.data?.[0];
  useRescueSettle(ship);

  if (user?.factionId == null) return null;

  const shipName =
    ship === undefined ? undefined : ship.name.trim() !== '' ? ship.name : hexPlaceholder(ship.id);

  let statusText: string | undefined;
  if (ship !== undefined) {
    const place = world.data?.locations.find((entry) => entry.id === ship.currentLocationId);
    const placeName =
      place === undefined
        ? ship.currentLocationId
        : pickLocalized(place.displayName, i18n.language);
    const { kind } = ship.activity;
    statusText =
      ship.status === 'ADRIFT'
        ? t('stage.floating')
        : kind === 'idle'
          ? t('stage.docked', { place: placeName })
          : kind === 'repairing'
            ? t('stage.repairingAt', { place: placeName })
            : t(`stage.mode.${kind}`);
  }

  const activity = ship?.activity;
  const running = activity !== undefined && activity.kind !== 'idle' && activity.until !== null;

  return (
    <section className="status-strip" aria-label={t('nav.status')}>
      <div className="ship-identity">
        <FactionBadge factionId={user.factionId} />
        {shipName !== undefined && <span className="ship-identity-name">{shipName}</span>}
        {statusText !== undefined && (
          <span className="ship-identity-status" aria-live="polite">
            {statusText}
            {running && activity.until !== null && (
              <>
                {STATUS_SEPARATOR}
                <Countdown
                  until={activity.until}
                  onElapsed={() => void queryClient.invalidateQueries({ queryKey: ['ships'] })}
                />
              </>
            )}
          </span>
        )}
      </div>
      <LastMissionLink />
    </section>
  );
}
