import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import type { ShipResponse } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { ShipStage } from '../../ui/ShipStage';
import { formatDuration } from '../../ui/duration';
import { useNow } from '../../ui/useNow';
import { useWorld } from './use-world';

const ACTIVITY_REFRESH_MS = 15_000;

/**
 * The ship stage for the pilot's own ship, driven by what the server says it is doing (flying,
 * scavenging, repairing, or docked). Re-reads the ship now and then, and the moment an activity's
 * timer runs out, so the scene changes when the job ends without a reload.
 */
export function ActiveShipStage({
  size = 'hero',
  collapsed = false,
}: {
  size?: 'hero' | 'compact' | 'slim';
  /** Owner request (hangar, extra screen space): replace the animated scene with a small text
      placeholder — the data keeps loading/refreshing underneath either way. */
  collapsed?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const shipsQuery = useQuery({
    queryKey: ['ships'],
    refetchInterval: ACTIVITY_REFRESH_MS,
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const world = useWorld();
  const ship = shipsQuery.data?.[0];
  // A mining contract flies out and then digs, an explore one then scans (`flightThen`): the scene is flying until
  // `flightUntil`, then at work until the arrival.
  const flightUntil = ship?.activity.flightUntil ?? null;
  const now = useNow(flightUntil !== null);
  if (ship === undefined) return null;

  const place = world.data?.locations.find((entry) => entry.id === ship.currentLocationId);
  const placeName =
    place === undefined ? ship.currentLocationId : pickLocalized(place.displayName, i18n.language);
  const { kind: activityKind, until: activityUntil } = ship.activity;
  const scans = ship.activity.flightThen === 'scanning';
  const working =
    activityKind === 'flying' && flightUntil !== null && now >= Date.parse(flightUntil);
  const kind = working ? (ship.activity.flightThen ?? 'mining') : activityKind;
  const flightLeg = activityKind === 'flying' && flightUntil !== null && !working;
  const until = flightLeg ? flightUntil : activityUntil;
  const thenWork = (time: string) =>
    scans ? t('stage.thenScanning', { time }) : t('stage.thenMining', { time });
  const detail =
    kind === 'idle'
      ? t('stage.docked', { place: placeName })
      : kind === 'repairing'
        ? t('stage.repairingAt', { place: placeName })
        : flightLeg && activityUntil !== null
          ? thenWork(
              formatDuration(
                Math.max(
                  0,
                  Math.round((Date.parse(activityUntil) - Date.parse(flightUntil)) / 1000),
                ),
                t,
              ),
            )
          : undefined;

  return (
    <ShipStage
      mode={kind}
      placeId={working ? undefined : ship.currentLocationId}
      until={until}
      size={size}
      detail={detail}
      placeName={placeName}
      collapsed={collapsed}
      // a job on foot leaves the ship docked (a job with the ship locks it ON_MISSION): the ship stays still
      still={kind === 'scavenging' && ship.status === 'IN_PORT'}
      onElapsed={() => void queryClient.invalidateQueries({ queryKey: ['ships'] })}
    />
  );
}
