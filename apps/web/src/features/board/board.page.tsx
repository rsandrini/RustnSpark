import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useFeedback } from '../../ui/feedback';
import { BlockerChip } from '../../ui/kit/BlockerChip';
import { PlaceBanner } from '../../ui/PlaceArt';
import { activeAsOffer } from './active-offer';
import { MissionRow } from './mission-row';
import { EmptyShipNotice } from '../ship/empty-ship-notice';
import { BoardFilters, type SortKey } from './board-filters';
import { fixHref, fixOf } from './requirement-fix';
import { reasonLabel } from './reason-label';
import { EscortNotice } from '../ship/escort-notice';
import { client } from '../../api/client';
import { haptic } from '../../ui/haptics';
import { errorText } from '../../api/errors';
import type {
  ActiveMission,
  MissionOffer,
  MissionType,
  ShipResponse,
  WorldResponse,
} from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { useAuthContext } from '../auth/auth.context';
import { RescueBanner } from '../rescue/rescue-banner';
import { PendingStrip } from '../ship/pending-strip';
import { usePrologueMode } from '../prologue/prologue-mode';

const BOARD_REFETCH_MS = 15000;

/** Sorting happens here over the offers already loaded; the server's order is only the tie-break. */
function compareOffers(key: SortKey, a: MissionOffer, b: MissionOffer): number {
  switch (key) {
    case 'reward':
      return b.reward - a.reward;
    case 'time':
      return (
        (a.info.estimate?.durationSeconds ?? Number.MAX_SAFE_INTEGER) -
        (b.info.estimate?.durationSeconds ?? Number.MAX_SAFE_INTEGER)
      );
    case 'risk':
      return a.info.peakDanger - b.info.peakDanger;
    case 'expires':
      return Date.parse(a.expiresAt) - Date.parse(b.expiresAt);
  }
}

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
  // Defaults on (owner request): most offers on a busy board are ones the ship can't take yet,
  // and the pilot generally wants to see what they CAN take first.
  // In the opening the pilot sees every job, even the ones the ship cannot take yet: that is what the first stop is about.
  const { active: opening, sandbox } = usePrologueMode();
  // the first stop of the opening: the pilot picks the kind of job (its module is bought next)
  const choosing =
    opening && sandbox !== null && sandbox.state.slot === 1 && sandbox.state.chosen === null;
  const [onlyEligible, setOnlyEligible] = useState(!opening);
  const [sortKey, setSortKey] = useState<SortKey>('reward');
  const [actionError, setActionError] = useState<string | null>(null);

  const shipsQuery = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const worldQuery = useQuery({
    queryKey: ['world'],
    queryFn: () => client.get<WorldResponse>('/v1/locations'),
  });

  // The mission already taken stays readable here too, not only on My Ship.
  const activeQuery = useQuery({
    queryKey: ['active'],
    queryFn: () => client.get<ActiveMission[]>('/v1/missions/active'),
  });
  const taken = (activeQuery.data ?? []).find((entry) => activeAsOffer(entry) !== null);
  const takenOffer = taken === undefined ? null : activeAsOffer(taken);

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
    haptic('error');
    setActionError(errorText(t, error, t('board.failed')));
  };

  const feedback = useFeedback();
  const accept = useMutation({
    mutationFn: (offer: MissionOffer) =>
      client.post(`/v1/missions/${offer.id}/accept`, { shipId: ship?.id ?? '' }),
    onSuccess: () => {
      setActionError(null);
      feedback.notify(t('feedback.accepted'));
      invalidateBoard();
      // Loop step S10.10: accepted → the travel summary, where dispatch happens.
      if (embedded && onGoToShip !== undefined) {
        onGoToShip();
      } else {
        void navigate('/ship');
      }
    },
    onError,
  });
  const hold = useMutation({
    mutationFn: (offer: MissionOffer) => client.post(`/v1/missions/${offer.id}/hold`),
    onSuccess: () => {
      setActionError(null);
      feedback.notify(t('feedback.held'));
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

  const ofType = (boardQuery.data ?? []).filter(
    (offer) => typeFilter === 'all' || offer.type === typeFilter,
  );
  const offers = ofType
    .filter((offer) => !onlyEligible || offer.eligibility.eligible)
    .sort((a, b) => compareOffers(sortKey, a, b));
  const hiddenCount = ofType.length - offers.length;
  const counts: Partial<Record<MissionType, number>> = {};
  for (const offer of boardQuery.data ?? []) counts[offer.type] = (counts[offer.type] ?? 0) + 1;
  const takeableCount = ofType.filter((offer) => offer.eligibility.eligible).length;
  // What is wrong with the SHIP itself (structure over budget, no engine, an unpowered system...):
  // it blocks every offer at once, so it is said once, above the list, not only inside each card.
  const shipFaults = [
    ...new Map(
      (boardQuery.data ?? [])
        .flatMap((offer) => offer.eligibility.reasons)
        .filter((reason) => i18n.exists(`hangar.problems.${reason.code}`))
        .map((reason) => [reason.code, reason] as const),
    ).values(),
  ];

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
      {!boardQuery.isLoading && (
        <p className="board-summary">
          {t('board.summary', { open: ofType.length, can: takeableCount })}
        </p>
      )}
      <EscortNotice />

      {shipFaults.length > 0 && (
        <div
          className="board-faults"
          data-testid="ship-faults"
          role="group"
          aria-label={t('board.shipFaultsGroup')}
        >
          {shipFaults.map((fault) => {
            const target = fixOf(fault.code);
            const label = reasonLabel(t, fault.code, fault.message);
            // embedded, the ship screen is the host's own tab: switch to it instead of navigating
            if (target.kind === 'ship' && embedded && onGoToShip !== undefined) {
              return <BlockerChip key={fault.code} label={label} onFix={onGoToShip} />;
            }
            const to = fixHref(target);
            return (
              <BlockerChip key={fault.code} label={label} {...(to !== undefined ? { to } : {})} />
            );
          })}
        </div>
      )}

      {/* An unassembled ship with nothing on the shelf has no offer to carry the fault chips: the notice
          speaks for it then (and only then, so the problem is never told twice). */}
      {!boardQuery.isLoading && shipFaults.length === 0 && offers.length === 0 && (
        <EmptyShipNotice />
      )}

      <RescueBanner />

      <PendingStrip />

      <BoardFilters
        type={typeFilter}
        onType={setTypeFilter}
        counts={counts}
        onlyEligible={onlyEligible}
        onOnlyEligible={setOnlyEligible}
        sort={sortKey}
        onSort={setSortKey}
        showEligibleToggle={!opening}
      />

      {takenOffer !== null && (
        <ul className="mrow-list">
          <MissionRow
            offer={takenOffer}
            origin={worldQuery.data?.locations.find((entry) => entry.id === takenOffer.originId)}
            destination={worldQuery.data?.locations.find(
              (entry) => entry.id === takenOffer.destinationId,
            )}
            mine
            taken
            tag={t('board.yourMission')}
            actions={
              <button
                type="button"
                className="btn primary"
                data-opening="open-ship"
                onClick={() => {
                  if (embedded && onGoToShip !== undefined) onGoToShip();
                  else void navigate('/ship');
                }}
              >
                {t('board.goToShip')}
              </button>
            }
            {...(ship !== undefined
              ? { fuelHave: ship.fuel, fuelCap: ship.sheet.fuelCap, fuelUse: ship.sheet.fuelUse }
              : {})}
            {...(ship?.engineLevels !== undefined ? { engineLevels: ship.engineLevels } : {})}
            {...(worldQuery.data !== undefined ? { world: worldQuery.data } : {})}
          />
        </ul>
      )}

      {ship === undefined && originId === null && <p className="sub">{t('board.noShip')}</p>}
      {actionError !== null && (
        <p className="error-text" role="alert">
          {actionError}
        </p>
      )}
      {boardQuery.isLoading && <p>{t('loading')}</p>}
      {!boardQuery.isLoading && offers.length === 0 && (
        <p className="sub board-empty">
          {hiddenCount > 0 ? t('board.emptyEligible', { count: hiddenCount }) : t('board.empty')}
        </p>
      )}

      <ul className="mrow-list">
        {offers.map((offer) => {
          const mine = offer.playerId === user?.id;
          // A scavenging run (with the ship or on foot) holds the pilot: no new mission until it ends.
          const scavenging = ship?.activity.kind === 'scavenging';
          const canAccept =
            ship !== undefined &&
            !scavenging &&
            offer.eligibility.eligible &&
            (offer.status === 'AVAILABLE' || (offer.status === 'HELD' && mine));
          const acceptLabel = scavenging
            ? t('board.busyScavenging')
            : offer.eligibility.eligible
              ? t('board.accept')
              : t('board.locked');
          return (
            <MissionRow
              key={offer.id}
              offer={offer}
              origin={worldQuery.data?.locations.find((entry) => entry.id === offer.originId)}
              destination={worldQuery.data?.locations.find(
                (entry) => entry.id === offer.destinationId,
              )}
              fuelHave={ship?.fuel}
              fuelCap={ship?.sheet.fuelCap}
              fuelUse={ship?.sheet.fuelUse}
              world={worldQuery.data}
              mine={mine}
              actions={
                <>
                  {choosing && offer.status === 'AVAILABLE' && (
                    <button
                      type="button"
                      className="btn primary"
                      data-opening="choose"
                      onClick={() =>
                        sandbox.choose(offer.type === 'TRANSPORT' ? 'passengers' : 'crates')
                      }
                    >
                      {t('prologue.director.choose')}
                    </button>
                  )}
                  {!choosing && offer.status === 'AVAILABLE' && (
                    <button
                      type="button"
                      className="btn primary"
                      data-tour="accept_button"
                      disabled={!canAccept || accept.isPending}
                      onClick={() => accept.mutate(offer)}
                    >
                      {acceptLabel}
                    </button>
                  )}
                  {!opening && offer.status === 'AVAILABLE' && (
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
                        {acceptLabel}
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
      </ul>
    </>
  );

  if (embedded) return body;
  return (
    <main className="app" data-guided={guided ? '' : undefined}>
      {body}
    </main>
  );
}
