import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import { errorText } from '../../api/errors';
import type { MissionOffer, MissionType, ShipResponse, WorldResponse } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { useAuthContext } from '../auth/auth.context';
import { RescueBanner } from '../rescue/rescue-banner';
import { Countdown } from '../../ui/Countdown';
import { ItemCard } from '../../ui/ItemCard';
import { RiskBadge } from '../../ui/RiskBadge';

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
}

export function BoardPage({ guided = false }: BoardPageProps) {
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
      // Loop step S10.10: accepted → the transit screen, where dispatch happens.
      navigate('/transit');
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
    return (
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
  // Unknown destination → no badge: inventing a risk band would be a made-up rule.
  const destinationRisk = (offer: MissionOffer) =>
    worldQuery.data?.locations.find((entry) => entry.id === offer.destinationId)?.risk;

  return (
    <main className="app" data-guided={guided ? '' : undefined}>
      <header className="topbar">
        <h1>{t('board.title')}</h1>
        <span className="sub">{originId === null ? '' : locationName(originId)}</span>
      </header>

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

      <div className="stack">
        {offers.map((offer) => {
          const routeLabel = `${locationName(offer.originId)} → ${locationName(offer.destinationId)}`;
          const mine = offer.playerId === user?.id;
          const canAccept =
            ship !== undefined &&
            offer.eligibility.eligible &&
            (offer.status === 'AVAILABLE' || (offer.status === 'HELD' && mine));
          return (
            <ItemCard
              key={offer.id}
              name={`${t(`board.type.${offer.type}`)} — ${routeLabel}`}
              description={
                <>
                  <div className="sub">
                    {[
                      t('board.reward', { amount: offer.reward }),
                      t('board.estimate', { amount: offer.rewardEstimate }),
                    ].join(' · ')}
                  </div>
                  <div className="row-between">
                    {destinationRisk(offer) !== undefined && (
                      <RiskBadge band={destinationRisk(offer)!} />
                    )}
                    <span className="sub">
                      {t('board.expires')} <Countdown until={offer.expiresAt} />
                    </span>
                    <span className={`badge ${offer.eligibility.eligible ? 'ok' : 'warn'}`}>
                      {offer.eligibility.eligible ? t('board.eligible') : t('board.blocked')}
                    </span>
                    {offer.status !== 'AVAILABLE' && (
                      <span className="badge">{t(`board.status.${offer.status}`)}</span>
                    )}
                  </div>
                  {!offer.eligibility.eligible && (
                    <ul className="reasons">
                      {offer.eligibility.reasons.map((reason, index) => (
                        <li key={`${reason.code}-${index}`}>
                          {t(`board.reasons.${reason.code}`, {
                            defaultValue: t(`error.${reason.code}`, {
                              defaultValue: reason.message,
                            }),
                          })}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              }
              action={
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
    </main>
  );
}
