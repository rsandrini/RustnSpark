import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PlaceBanner } from '../../ui/PlaceArt';
import { MissionCard } from './mission-card';
import { EmptyShipNotice } from '../ship/empty-ship-notice';
import { client } from '../../api/client';
import { errorText } from '../../api/errors';
import type { MissionOffer, MissionType, ShipResponse, WorldResponse } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { useAuthContext } from '../auth/auth.context';
import { RescueBanner } from '../rescue/rescue-banner';

const BOARD_REFETCH_MS = 15000;

const MISSION_TYPES: readonly MissionType[] = [
  'DELIVERY',
  'TRANSPORT',
  'ESCORT',
  'MINING',
  'RESCUE',
];

export interface BoardPageProps {
  /** Placeholder for the future guided tour (GDD §16; not built in v0.1, S10.3). */
  guided?: boolean;
  /** Mounted as a My Ship tab (round-3 nav consolidation): no own <main>/<h1>, the host has one. */
  embedded?: boolean;
  /** Embedded only: switches the host to its own "Ship" tab after accepting (a navigate() to
      /hangar would be a no-op there, since /hangar already is the current route). */
  onGoToShip?: () => void;
}

export function BoardPage({ guided = false, embedded = false, onGoToShip }: BoardPageProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuthContext();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<MissionType | 'all'>('all');
  const [actionError, setActionError] = useState<string | null>(null);

  const shipsQuery = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const worldQuery = useQuery({
    queryKey: ['world'],
    queryFn: () => client.get<WorldResponse>('/v1/locations'),
  });

  const ship = shipsQuery.data?.[0];
  const originId = params.get('location') ?? ship?.currentLocationId ?? null;

  const boardQuery = useQuery({
    queryKey: ['board', originId],
    enabled: originId !== null,
    refetchInterval: BOARD_REFETCH_MS,
    queryFn: () => client.get<MissionOffer[]>(`/v1/locations/${originId ?? ''}/missions`),
  });

  const invalidateBoard = () => {
    void queryClient.invalidateQueries({ queryKey: ['board'] });
    void queryClient.invalidateQueries({ queryKey: ['active'] });
  };
  const onError = (error: unknown) => {
    setActionError(errorText(t, error, t('board.failed')));
  };

  const accept = useMutation({
    mutationFn: (offer: MissionOffer) =>
      client.post(`/v1/missions/${offer.id}/accept`, { shipId: ship?.id ?? '' }),
    onSuccess: () => {
      setActionError(null);
      invalidateBoard();
      // Loop step S10.10: accepted → the travel summary, where dispatch happens.
      if (embedded && onGoToShip !== undefined) {
        onGoToShip();
      } else {
        void navigate('/hangar');
      }
    },
    onError,
  });
  const hold = useMutation({
    mutationFn: (offer: MissionOffer) => client.post(`/v1/missions/${offer.id}/hold`),
    onSuccess: () => {
      setActionError(null);
      invalidateBoard();
    },
    onError,
  });
  const release = useMutation({
    mutationFn: (offer: MissionOffer) => client.delete(`/v1/missions/${offer.id}/hold`),
    onSuccess: () => {
      setActionError(null);
      invalidateBoard();
    },
    onError,
  });

  if (shipsQuery.isLoading || worldQuery.isLoading) {
    return embedded ? (
      <p>{t('loading')}</p>
    ) : (
      <main className="app" data-guided={guided ? '' : undefined}>
        {t('loading')}
      </main>
    );
  }

  const locationName = (id: string) => {
    const location = worldQuery.data?.locations.find((entry) => entry.id === id);
    if (location === undefined) return id;
    return pickLocalized(location.displayName, i18n.language);
  };

  const offers = (boardQuery.data ?? []).filter(
    (offer) => typeFilter === 'all' || offer.type === typeFilter,
  );

  const body = (
    <>
      {!embedded && (
        <header className="topbar">
          <h1>{t('board.title')}</h1>
          <span className="sub">{originId === null ? '' : locationName(originId)}</span>
        </header>
      )}
      {/* The place is already shown in the ship stage at the top of My Ship when embedded (owner
          request — this banner duplicated it); the standalone page still gets its own. */}
      {!embedded && originId !== null && (
        <PlaceBanner placeId={originId}>
          <h2>{locationName(originId)}</h2>
        </PlaceBanner>
      )}
      <EmptyShipNotice />

      <RescueBanner />

      <div className="tabs" role="tablist" aria-label={t('board.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={typeFilter === 'all'}
          className={`tab${typeFilter === 'all' ? ' on' : ''}`}
          onClick={() => setTypeFilter('all')}
        >
          {t('board.filterAll')}
        </button>
        {MISSION_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={typeFilter === type}
            className={`tab${typeFilter === type ? ' on' : ''}`}
            onClick={() => setTypeFilter(type)}
          >
            {t(`board.type.${type}`)}
          </button>
        ))}
      </div>

      {ship === undefined && originId === null && <p className="sub">{t('board.noShip')}</p>}
      {actionError !== null && (
        <p className="error-text" role="alert">
          {actionError}
        </p>
      )}
      {boardQuery.isLoading && <p>{t('loading')}</p>}
      {!boardQuery.isLoading && offers.length === 0 && <p className="sub">{t('board.empty')}</p>}

      <div className="mcard-grid">
        {offers.map((offer) => {
          const mine = offer.playerId === user?.id;
          const canAccept =
            ship !== undefined &&
            offer.eligibility.eligible &&
            (offer.status === 'AVAILABLE' || (offer.status === 'HELD' && mine));
          return (
            <MissionCard
              key={offer.id}
              offer={offer}
              origin={worldQuery.data?.locations.find((entry) => entry.id === offer.originId)}
              destination={worldQuery.data?.locations.find(
                (entry) => entry.id === offer.destinationId,
              )}
              fuelHave={ship?.fuel}
              fuelCap={ship?.sheet.fuelCap}
              mine={mine}
              actions={
                <>
                  {offer.status === 'AVAILABLE' && (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={!canAccept || accept.isPending}
                      onClick={() => accept.mutate(offer)}
                    >
                      {t('board.accept')}
                    </button>
                  )}
                  {offer.status === 'AVAILABLE' && (
                    <button
                      type="button"
                      className="btn"
                      disabled={hold.isPending}
                      onClick={() => hold.mutate(offer)}
                    >
                      {t('board.hold')}
                    </button>
                  )}
                  {offer.status === 'HELD' && mine && (
                    <>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={!canAccept || accept.isPending}
                        onClick={() => accept.mutate(offer)}
                      >
                        {t('board.accept')}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={release.isPending}
                        onClick={() => release.mutate(offer)}
                      >
                        {t('board.release')}
                      </button>
                    </>
                  )}
                </>
              }
            />
          );
        })}
      </div>
    </>
  );

  if (embedded) return body;
  return (
    <main className="app" data-guided={guided ? '' : undefined}>
      {body}
    </main>
  );
}
