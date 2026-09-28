import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import type { ShipResponse } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { ShipStage } from '../../ui/ShipStage';
import { useWorld } from './use-world';

const ACTIVITY_REFRESH_MS = 15_000;

/**
 * The ship stage for the pilot's own ship, driven by what the server says it is doing (flying,
 * scavenging, repairing, or docked). Re-reads the ship now and then, and the moment an activity's
 * timer runs out, so the scene changes when the job ends without a reload.
 */
export function ActiveShipStage({ size = 'hero' }: { size?: 'hero' | 'compact' }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const shipsQuery = useQuery({
    queryKey: ['ships'],
    refetchInterval: ACTIVITY_REFRESH_MS,
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const world = useWorld();
  const ship = shipsQuery.data?.[0];
  if (ship === undefined) return null;

  const place = world.data?.locations.find((entry) => entry.id === ship.currentLocationId);
  const placeName =
    place === undefined ? ship.currentLocationId : pickLocalized(place.displayName, i18n.language);
  const { kind, until } = ship.activity;
  const detail =
    kind === 'idle'
      ? t('stage.docked', { place: placeName })
      : kind === 'repairing'
        ? t('stage.repairingAt', { place: placeName })
        : undefined;

  return (
    <ShipStage
      mode={kind}
      placeId={ship.currentLocationId}
      until={until}
      size={size}
      detail={detail}
      placeName={placeName}
      onElapsed={() => void queryClient.invalidateQueries({ queryKey: ['ships'] })}
    />
  );
}
