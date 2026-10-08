import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client, serverNow } from '../../api/client';
import { errorText, priceChangedActualOf } from '../../api/errors';
import { useIntentKey } from '../../api/intent-key';
import type {
  InventoryItem,
  MarketResponse,
  MaterialsResponse,
  DiscardResponse,
  PartUpgradeQuoteResponse,
  PartUpgradeResponse,
  RefuelQuoteResponse,
  RefuelResponse,
  RepairQuoteResponse,
  RepairStartResponse,
  ScavengeInfo,
  DispatchResponse,
  SellResponse,
  SellMaterialResponse,
  ShipResponse,
  WorldResponse,
  PreviewResponse,
} from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { useAuthContext } from '../auth/auth.context';
import { RescueBanner } from '../rescue/rescue-banner';
import { Popup } from '../../ui/Popup';
import { Countdown } from '../../ui/Countdown';
import { formatDuration } from '../../ui/duration';
import { Gauge, conditionTone } from '../../ui/Gauge';
import { PartThumb } from '../../ui/PartThumb';
import { PlaceBanner } from '../../ui/PlaceArt';
import { PortTabs } from '../../ui/PortTabs';
import { ActiveShipStage } from '../ship/active-ship-stage';
import { MarketPanel } from '../market/market-panel';
import { PartCard } from '../parts/part-card';
import { useDisplay } from '../../ui/display';
import { PartDetail } from '../parts/part-detail';
import type { PartCompareContext, PartInfoData } from '../parts/part-detail';

const PORT_TABS = ['market', 'goods', 'repair', 'refuel', 'upgrade', 'scavenging', 'mining'] as const;
type PortTabId = (typeof PORT_TABS)[number];

interface UpgradeConfirm {
  partInstanceId: string;
  name: string;
  nextName: string;
  cost: number;
}

interface RepairTarget {
  partInstanceId: string;
  toCondition: number;
}

interface RepairPlan {
  targets: RepairTarget[];
  cost: number;
  seconds: number;
}

interface ConfirmTrade {
  kind: 'sellPart' | 'sellMaterial';
  name: string;
  price: number | null;
  partInstanceId?: string;
  materialId?: string;
  quantity?: number;
  hint?: string;
}

export interface PortPageProps {
  /** Placeholder for the future guided tour (GDD §16; not built in v0.1, S10.3). */
  guided?: boolean;
  /** Mounted as a My Ship tab (round-3 nav consolidation): no own <main>/<h1>/ship-stage — the
      host (My Ship) already has its own of each. */
  embedded?: boolean;
  /** Embedded only: switches the host to its own "Ship" tab (a route Link would just reload
      the current page, since /hangar already is the current page). */
  onGoToShip?: () => void;
  /** Embedded only (owner request): a DOM node the host wants Port's own tab row (Market/Your
      goods/Repair/…) portaled into instead of rendered inline — My Ship uses this to put it
      above the ship animation, left-aligned, right under the top nav, since it's the only
      sub-navigation left once a tab is open. Port keeps owning the tab state either way. */
  subNavContainer?: HTMLDivElement | null;
}

export function PortPage({
  guided = false,
  embedded = false,
  onGoToShip,
  subNavContainer,
}: PortPageProps) {
  const { t, i18n } = useTranslation();
  const { user, reloadProfile } = useAuthContext();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<PortTabId>('market');
  const [confirm, setConfirm] = useState<ConfirmTrade | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [repairTargets, setRepairTargets] = useState<Record<string, number>>({});
  const [repairPlan, setRepairPlan] = useState<RepairPlan | null>(null);
  const sellKey = useIntentKey();
  const materialKey = useIntentKey();
  const refuelKey = useIntentKey();
  const repairKey = useIntentKey();
  const upgradeKey = useIntentKey();
  const [upgradeConfirm, setUpgradeConfirm] = useState<UpgradeConfirm | null>(null);

  const shipsQuery = useQuery({
    queryKey: ['ships'],
    queryFn: () => client.get<ShipResponse[]>('/v1/ships'),
  });
  const ship = shipsQuery.data?.[0];
  // The port is wherever the ship is docked: the market answers 409 for any other place.
  const locationId = ship?.currentLocationId;

  const marketQuery = useQuery({
    queryKey: ['market', locationId],
    enabled: locationId !== undefined,
    queryFn: () => client.get<MarketResponse>(`/v1/locations/${locationId ?? ''}/market`),
  });
  const inventoryQuery = useQuery({
    queryKey: ['inventory'],
    // While the workshop is at work the parts' condition climbs: keep the numbers moving.
    refetchInterval: ship?.activity.kind === 'repairing' ? 4000 : false,
    queryFn: () => client.get<InventoryItem[]>('/v1/inventory'),
  });
  const materialsQuery = useQuery({
    queryKey: ['materials'],
    queryFn: () => client.get<MaterialsResponse>('/v1/materials'),
  });
  const scavengeInfoQuery = useQuery({
    queryKey: ['scavenge', locationId],
    enabled: locationId !== undefined && tab === 'scavenging',
    queryFn: () => client.get<ScavengeInfo>(`/v1/locations/${locationId ?? ''}/scavenge`),
  });
  // Whether the ship could fly right now: a ship that cannot (or flies with warnings) still
  // scavenges by hand, but finds less — the Scavenging tab says so up front.
  const display = useDisplay();
  const readinessQuery = useQuery({
    queryKey: ['shipReadiness', ship?.id, ship?.layout],
    enabled: ship !== undefined && tab === 'scavenging',
    queryFn: () =>
      client.post<PreviewResponse>(`/v1/ships/${ship?.id ?? ''}/preview`, { layout: ship?.layout ?? [] }),
  });
  const shipHandicapped =
    readinessQuery.data !== undefined &&
    (!readinessQuery.data.viability.viable || readinessQuery.data.viability.warnings.length > 0);
  // The repair plan: only parts the pilot moved past their current condition are repaired.
  const damagedInstalled = useMemo(
    () =>
      (inventoryQuery.data ?? []).filter(
        (entry) => entry.location === 'INSTALLED' && entry.condition < 100 && !entry.broken,
      ),
    [inventoryQuery.data],
  );
  const changedTargets = useMemo<RepairTarget[]>(
    () =>
      damagedInstalled.flatMap((item) => {
        const target = repairTargets[item.id];
        return target !== undefined && target > item.condition
          ? [{ partInstanceId: item.id, toCondition: target }]
          : [];
      }),
    [damagedInstalled, repairTargets],
  );
  // Default to a full repair the first time there's damage to quote, so the workshop fee is a
  // real number as soon as the tab opens instead of 0 until the pilot touches a slider (owner:
  // "show the Workshop fee as default"). A ref (not "targets is empty") guards it, so the
  // deliberate Reset button still means "nothing selected" and isn't fought back to 100%.
  const repairDefaulted = useRef(false);
  useEffect(() => {
    if (!repairDefaulted.current && damagedInstalled.length > 0) {
      repairDefaulted.current = true;
      setRepairTargets(Object.fromEntries(damagedInstalled.map((entry) => [entry.id, 100])));
    }
  }, [damagedInstalled]);
  const repairQuoteQuery = useQuery({
    queryKey: ['repairQuote', ship?.id, changedTargets],
    enabled: tab === 'repair' && ship !== undefined && changedTargets.length > 0,
    placeholderData: keepPreviousData,
    queryFn: () =>
      client.post<RepairQuoteResponse>(`/v1/ships/${ship?.id ?? ''}/repair/quote`, {
        targets: changedTargets,
      }),
  });
  const worldQuery = useQuery({
    queryKey: ['world'],
    queryFn: () => client.get<WorldResponse>('/v1/locations'),
  });

  // Upgrade mechanism only (round 5): eligibility comes from the catalog's own tier-naming
  // convention server-side, not anything decided here — this tab just quotes every owned part
  // (installed or loose) and shows the ones that came back eligible. A part whose family has no
  // next-tier catalog row yet simply never appears.
  const upgradeCandidates = inventoryQuery.data ?? [];
  const upgradeQuotesQuery = useQuery({
    queryKey: ['upgradeQuotes', upgradeCandidates.map((item) => item.id)],
    enabled: tab === 'upgrade' && upgradeCandidates.length > 0,
    queryFn: async () => {
      const quotes = await Promise.all(
        upgradeCandidates.map((item) =>
          client.post<PartUpgradeQuoteResponse>(`/v1/parts/${item.id}/upgrade/quote`),
        ),
      );
      return new Map(quotes.map((quote) => [quote.partInstanceId, quote]));
    },
  });

  const money = (value: number) => `${new Intl.NumberFormat(i18n.language).format(value)} ¢`;
  const locationName = (id: string) => {
    const location = worldQuery.data?.locations.find((entry) => entry.id === id);
    if (location === undefined) return id;
    return pickLocalized(location.displayName, i18n.language);
  };
  const partName = (item: InventoryItem) => pickLocalized(item.displayName, i18n.language);

  const wallet = user?.credits ?? 0;
  const broke = wallet < 0;
  const afterTrade = () => {
    // Profile only (wallet): a session refresh per trade would rotate the refresh token.
    void reloadProfile();
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['materials'] });
    void queryClient.invalidateQueries({ queryKey: ['market'] });
    void queryClient.invalidateQueries({ queryKey: ['ships'] });
  };

  // A stale quote: the server's actual price replaces the one on screen and the player
  // confirms again (a new expectedPrice is a new action, so it gets a new key).
  const onTradeError = (error: unknown) => {
    const actual = priceChangedActualOf(error);
    if (actual !== undefined && confirm !== null) {
      setActionError(null);
      setConfirm({ ...confirm, price: actual, hint: t('port.priceUpdated', { price: actual }) });
      void queryClient.invalidateQueries({ queryKey: ['market'] });
      return;
    }
    setActionError(errorText(t, error, t('port.failed')));
  };

  const sellPart = useMutation({
    mutationFn: (args: { partInstanceId: string; expectedPrice: number }) =>
      client.post<SellResponse>('/v1/market/sell', args, {
        idempotencyKey: sellKey.keyFor(`${args.partInstanceId}:${args.expectedPrice}`),
      }),
    onSuccess: (response) => {
      sellKey.clear();
      const soldName = confirm?.name ?? '';
      setConfirm(null);
      setActionError(null);
      setNotice(t('port.sold', { name: soldName, price: response.price }));
      afterTrade();
    },
    onError: onTradeError,
  });

  const sellMaterial = useMutation({
    mutationFn: (args: { materialId: string; quantity: number; expectedPrice: number }) =>
      client.post<SellMaterialResponse>('/v1/market/sell-material', args, {
        idempotencyKey: materialKey.keyFor(
          `${args.materialId}:${args.quantity}:${args.expectedPrice}`,
        ),
      }),
    onSuccess: (response) => {
      materialKey.clear();
      const soldName = confirm?.name ?? '';
      setConfirm(null);
      setActionError(null);
      setNotice(t('port.sold', { name: soldName, price: response.price }));
      afterTrade();
    },
    onError: onTradeError,
  });

  // Refuel: choose how much (slider); the server prices that exact amount before anything is charged.
  const [refuelUnits, setRefuelUnits] = useState<number | null>(null);
  const tankSpace =
    ship === undefined ? 0 : Math.max(0, Math.floor(ship.sheet.fuelCap - ship.fuel));
  // One quote gives the price of a unit here; the slider prices itself from it (the same formula the
  // server charges with), so dragging is instant and never shows a stale figure.
  const refuelQuoteQuery = useQuery({
    queryKey: ['refuelQuote', ship?.id, ship?.fuel],
    enabled: tab === 'refuel' && ship !== undefined && tankSpace > 0,
    queryFn: () =>
      client.post<RefuelQuoteResponse>(`/v1/ships/${ship?.id ?? ''}/refuel/quote`, {
        mode: 'full',
      }),
  });
  const unitPrice = refuelQuoteQuery.data?.unitPrice ?? 0;
  const costOf = (units: number) => (units <= 0 ? 0 : Math.max(1, Math.round(units * unitPrice)));
  // It opens on what the pilot can pay for (the whole tank when affordable), never on a price
  // they cannot meet.
  const affordableUnits =
    unitPrice > 0 ? Math.min(tankSpace, Math.max(0, Math.floor(wallet / unitPrice))) : tankSpace;
  const wantedUnits = Math.min(refuelUnits ?? affordableUnits, tankSpace);
  const refuel = useMutation({
    mutationFn: (units: number) =>
      client.post<RefuelResponse>(
        `/v1/ships/${ship?.id ?? ''}/refuel`,
        { mode: 'partial', amount: units },
        { idempotencyKey: refuelKey.keyFor(`refuel:${ship?.id ?? ''}:${units}`) },
      ),
    onSuccess: (response) => {
      refuelKey.clear();
      setRefuelUnits(null);
      setActionError(null);
      setNotice(t('port.refueled', { units: response.units, cost: response.cost }));
      afterTrade();
    },
    onError: (error) => setActionError(errorText(t, error, t('port.failed'))),
  });

  // Repair is priced by the server before it is charged. The quote is asked for every time the
  // plan changes (per-part price and time plus the workshop fee), so the screen always shows
  // exactly what start will charge; only the paying request carries an Idempotency-Key.
  const repair = useMutation({
    mutationFn: (targets: RepairTarget[]) =>
      client.post<RepairStartResponse>(
        `/v1/ships/${ship?.id ?? ''}/repair`,
        { targets },
        { idempotencyKey: repairKey.keyFor(JSON.stringify(targets)) },
      ),
    onSuccess: (response) => {
      repairKey.clear();
      setRepairPlan(null);
      // The paid plan is spent: leaving it selected would compare its (old) total with the wallet
      // that was just debited and report "not enough money" for a repair that already went through.
      setRepairTargets({});
      setActionError(null);
      setNotice(
        t('port.repairStarted', {
          cost: response.cost,
          time: formatDuration(response.durationSeconds, t),
        }),
      );
      afterTrade();
    },
    onError: (error) => {
      setRepairPlan(null);
      setActionError(errorText(t, error, t('port.failed')));
    },
  });

  const upgradePart = useMutation({
    mutationFn: (partInstanceId: string) =>
      client.post<PartUpgradeResponse>(
        `/v1/parts/${partInstanceId}/upgrade`,
        {},
        { idempotencyKey: upgradeKey.keyFor(partInstanceId) },
      ),
    onSuccess: (response) => {
      upgradeKey.clear();
      setUpgradeConfirm(null);
      setActionError(null);
      setNotice(t('port.upgraded', { name: pickLocalized(response.displayName, i18n.language) }));
      void queryClient.invalidateQueries({ queryKey: ['upgradeQuotes'] });
      afterTrade();
    },
    onError: (error) => {
      setUpgradeConfirm(null);
      setActionError(errorText(t, error, t('port.failed')));
    },
  });

  const [discardOpen, setDiscardOpen] = useState(false);
  const discard = useMutation({
    mutationFn: () => client.post<DiscardResponse>('/v1/inventory/discard', {}),
    onSuccess: (response) => {
      setDiscardOpen(false);
      setActionError(null);
      setNotice(t('port.discarded', { count: response.discarded }));
      afterTrade();
    },
    onError: (error) => {
      setDiscardOpen(false);
      setActionError(errorText(t, error, t('port.failed')));
    },
  });

  // Scavenging is a timed job (a mission of its own): starting it sends the ship out and the pilot
  // to the Transit screen, where the report arrives when it ends.
  const navigate = useNavigate();
  const scavenge = useMutation({
    mutationFn: () => client.post<DispatchResponse>(`/v1/locations/${locationId ?? ''}/scavenge`),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['active'] });
      void queryClient.invalidateQueries({ queryKey: ['ships'] });
      void queryClient.invalidateQueries({ queryKey: ['scavenge'] });
      // Embedded, /hangar already IS the current route (a navigate() there would be a no-op),
      // so switch the host's own tab instead — same reason the "Install" link above does.
      if (embedded && onGoToShip !== undefined) {
        onGoToShip();
      } else {
        void navigate('/hangar');
      }
    },
    onError: (error) => {
      setActionError(errorText(t, error, t('port.failed')));
      void queryClient.invalidateQueries({ queryKey: ['scavenge'] });
    },
  });

  // Independent mining job (round 10 owner request): same shape as scavenging above — a timed
  // job at the ship's own location, no board offer, dispatched the same way. The server is the
  // only authority on whether this location is minable and the ship carries a mining rig;
  // NOT_MINABLE/NO_MINING_RIG surface through the same error text as any other action here.
  const mine = useMutation({
    mutationFn: () => client.post<DispatchResponse>(`/v1/locations/${locationId ?? ''}/mine`),
    onSuccess: () => {
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ['active'] });
      void queryClient.invalidateQueries({ queryKey: ['ships'] });
      if (embedded && onGoToShip !== undefined) {
        onGoToShip();
      } else {
        void navigate('/hangar');
      }
    },
    onError: (error) => {
      setActionError(errorText(t, error, t('port.failed')));
    },
  });

  if (
    marketQuery.isLoading ||
    inventoryQuery.isLoading ||
    materialsQuery.isLoading ||
    shipsQuery.isLoading ||
    worldQuery.isLoading
  ) {
    return embedded ? (
      <p>{t('loading')}</p>
    ) : (
      <main className="app" data-guided={guided ? '' : undefined}>
        {t('loading')}
      </main>
    );
  }

  if (ship === undefined) {
    return embedded ? (
      <p className="sub">{t('port.noShip')}</p>
    ) : (
      <main className="app" data-guided={guided ? '' : undefined}>
        <p className="sub">{t('port.noShip')}</p>
      </main>
    );
  }

  const inventory = inventoryQuery.data ?? [];
  const partsOnSale = inventory.filter((entry) => entry.location === 'INVENTORY');
  const installed = inventory.filter((entry) => entry.location === 'INSTALLED');
  const damaged = installed.filter((entry) => entry.condition < 100);
  const materials = materialsQuery.data?.materials ?? [];
  const fuel = ship.fuel;
  const fuelCap = ship.sheet.fuelCap;
  // A ship with no tank at all (fuelCap 0 — an all-ion ship, or one mid-refit) reads as
  // "0 / 0 = full" by the same math as a genuinely topped-up tank; the owner's report: with
  // fuelCap 0 "the UI is broken and I cannot buy more" — the real story is there is nowhere
  // to put fuel, not that the tank is already full.
  const noTank = fuelCap <= 0;
  const tankFull = !noTank && fuel >= fuelCap;

  const sellOfferOf = (partInstanceId: string): number | null =>
    marketQuery.data?.sellOffers.find((offer) => offer.partInstanceId === partInstanceId)?.price ??
    null;

  const confirmTrade = () => {
    if (confirm === null) return;
    if (
      confirm.kind === 'sellPart' &&
      confirm.partInstanceId !== undefined &&
      confirm.price !== null
    ) {
      sellPart.mutate({
        partInstanceId: confirm.partInstanceId,
        expectedPrice: confirm.price ?? 0,
      });
    }
    if (
      confirm.kind === 'sellMaterial' &&
      confirm.materialId !== undefined &&
      confirm.quantity !== undefined &&
      confirm.price !== null
    ) {
      sellMaterial.mutate({
        materialId: confirm.materialId,
        quantity: confirm.quantity,
        expectedPrice: confirm.price,
      });
    }
  };

  // When the next attempt opens, on the server clock (the info endpoint says how long is left).
  const scavengeRetryAt = new Date(
    serverNow() + (scavengeInfoQuery.data?.retryAfterSeconds ?? 0) * 1000,
  ).toISOString();
  // Totals come from the server's quote of the CURRENT plan; nothing selected is exactly zero.
  const repairQuote = changedTargets.length === 0 ? undefined : repairQuoteQuery.data;
  const repairTotalCost = repairQuote?.cost ?? 0;
  const repairTotalSeconds = repairQuote?.durationSeconds ?? 0;
  const repairOver = repairTotalCost > wallet;
  // Parts under the threshold are refused at every port; they can be repaired or discarded.
  const sellMin = marketQuery.data?.sellMinCondition ?? 15;
  const damagedCount = partsOnSale.filter((item) => item.condition < sellMin).length;
  const refuelCost = costOf(wantedUnits);
  const repairBadge = damaged.length > 0 ? damaged.length : undefined;

  // Credits repeated here, next to the tabs (owner: "hard to see my credits" deep in a tab like
  // Repair — the top bar's wallet is easy to lose track of that far down).
  const portTabsRow = (
    <div className="page-tabs-row">
      <PortTabs
        tabs={PORT_TABS.map((id) => ({
          id,
          label: t(`port.tabs.${id}`),
          badge: id === 'repair' ? repairBadge : undefined,
        }))}
        activeId={tab}
        onChange={(next) => setTab(next as PortTabId)}
      />
      <span className="wallet-chip" data-testid="port-tabs-wallet">
        {money(wallet)}
      </span>
    </div>
  );

  const body = (
    <>
      {subNavContainer != null && createPortal(portTabsRow, subNavContainer)}
      {!embedded && (
        <header className="topbar">
          <div>
            <h1>{t('port.title')}</h1>
            <span className="sub">
              {ship === undefined
                ? ''
                : t('port.at', { location: locationName(ship.currentLocationId) })}
            </span>
          </div>
          <div className="wallet">
            <div className="lbl">{t('port.wallet')}</div>
            <div className="amt" data-testid="wallet">
              {money(wallet)}
            </div>
            {broke && <div className="error-text">{t('port.negative')}</div>}
          </div>
        </header>
      )}
      {/* The header (and its wallet number) is My Ship's own when embedded, but the negative-
          balance warning is Port-specific and must not silently disappear with it. */}
      {embedded && broke && <p className="error-text">{t('port.negative')}</p>}

      {!embedded && (
        <PlaceBanner placeId={ship.currentLocationId} className="port-banner">
          <h2>{locationName(ship.currentLocationId)}</h2>
        </PlaceBanner>
      )}

      {!embedded && <ActiveShipStage size="compact" />}

      <RescueBanner />

      {subNavContainer == null && portTabsRow}

      {notice !== null && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {actionError !== null && (
        <p className="error-text" role="alert">
          {actionError}
        </p>
      )}

      {tab === 'market' && (
        <section className="stack">
          <MarketPanel
            locationId={ship.currentLocationId}
            onNotice={setNotice}
            shipId={ship.id}
            installedParts={installed}
            currentSheet={ship.sheet}
          />
        </section>
      )}

      {tab === 'goods' && (
        <section className="stack">
          <h2>{t('port.yourGoods')}</h2>
          {partsOnSale.length === 0 && <p className="sub">{t('port.noLooseParts')}</p>}
          {damagedCount > 0 && (
            <div className="panel discard-note" role="note" data-testid="discard-note">
              <p>{t('port.discardNote', { count: damagedCount, min: sellMin })}</p>
              <button type="button" className="btn danger" onClick={() => setDiscardOpen(true)}>
                {t('port.discardAction', { count: damagedCount })}
              </button>
            </div>
          )}
          <div className="pcard-grid">
            {partsOnSale.map((item) => {
              const offer = sellOfferOf(item.id);
              const tooDamaged = item.condition < sellMin;
              return (
                <PartCard
                  key={item.id}
                  part={item}
                  price={offer ?? undefined}
                  priceCaption={t('port.portPays')}
                  note={tooDamaged ? t('port.tooDamaged') : undefined}
                  actions={
                    <>
                      {embedded && onGoToShip !== undefined ? (
                        <button type="button" className="btn" onClick={onGoToShip}>
                          {t('inventory.install')}
                        </button>
                      ) : (
                        <Link className="btn" to="/hangar">
                          {t('inventory.install')}
                        </Link>
                      )}
                      <button
                        type="button"
                        className="btn primary"
                        disabled={offer === null}
                        onClick={() => {
                          setNotice(null);
                          setConfirm({
                            kind: 'sellPart',
                            name: partName(item),
                            price: offer,
                            partInstanceId: item.id,
                          });
                        }}
                      >
                        {t('port.sell')}
                      </button>
                    </>
                  }
                />
              );
            })}
          </div>

          <h3>{t('port.materials')}</h3>
          {materials.length === 0 && <p className="sub">{t('inventory.noMaterials')}</p>}
          <div className="pcard-grid">
            {materials.map((holding) => {
              const name = pickLocalized(holding.displayName, i18n.language);
              const total = holding.unitPrice * holding.quantity;
              const materialTitle = [t('port.quantity', { quantity: holding.quantity }), name].join(
                ' ',
              );
              return (
                <article key={holding.materialId} className="pcard rarity-common">
                  <header className="pcard-head">
                    <h3 className="pcard-name">{materialTitle}</h3>
                    <div className="pcard-price">
                      <b>{money(total)}</b>
                      <small>{t('port.unitPrice', { price: holding.unitPrice })}</small>
                    </div>
                  </header>
                  <footer className="pcard-actions">
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => {
                        setNotice(null);
                        setConfirm({
                          kind: 'sellMaterial',
                          name,
                          price: total,
                          materialId: holding.materialId,
                          quantity: holding.quantity,
                        });
                      }}
                    >
                      {t('port.sellAll')}
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {tab === 'repair' && (
        <section className="stack" data-testid="repair">
          {damaged.length === 0 && <p className="sub">{t('port.repairNoDamage')}</p>}
          {damaged.length > 0 && <p className="sub">{t('port.repairHelp')}</p>}
          <div className="repair-list">
            {damaged.map((item) => {
              const condition = Math.round(item.condition);
              // The slider starts at the part's current state; nothing is repaired until it moves.
              const floor = Math.ceil(item.condition);
              const target = repairTargets[item.id] ?? floor;
              const changed = target > item.condition;
              const line = repairQuoteQuery.data?.items.find(
                (entry) => entry.partInstanceId === item.id,
              );
              const name = partName(item);
              // Two identical parts (two Cargo Holds) are told apart by a stable number.
              const same = damaged.filter((entry) => partName(entry) === name);
              const suffix = same.length > 1 ? ` #${same.indexOf(item) + 1}` : '';
              const rowName = `${name}${suffix}`;
              return (
                <div key={item.id} className="repair-row">
                  <div className="rname">
                    <PartThumb name={name} rarity={item.rarity} className="small" />
                    {rowName}
                    {item.broken && <span className="pcard-note">{t('parts.broken')}</span>}
                    <small>
                      {item.broken
                        ? t('port.repairDestroyed')
                        : t(`hangar.partClasses.${item.catalog.partClass}`)}
                    </small>
                  </div>
                  <Gauge
                    value={condition}
                    max={100}
                    planned={changed ? target : undefined}
                    tone={conditionTone(condition)}
                    ariaLabel={`${rowName}: ${t('port.conditionNow', { value: condition })}`}
                    label={
                      changed
                        ? t('port.conditionToTarget', { from: condition, to: target })
                        : t('port.conditionNow', { value: condition })
                    }
                  />
                  <input
                    type="range"
                    min={floor}
                    max={100}
                    step={1}
                    disabled={item.broken}
                    value={target}
                    aria-label={`${rowName} ${t('port.repairSlider', { value: target })}`}
                    onChange={(event) =>
                      setRepairTargets((current) => ({
                        ...current,
                        [item.id]: Number(event.target.value),
                      }))
                    }
                  />
                  <div
                    className={`rcost${changed && line !== undefined && line.cost > wallet ? ' over' : ''}`}
                    data-testid="repair-line"
                  >
                    {[
                      money(changed ? (line?.cost ?? 0) : 0),
                      formatDuration(changed ? (line?.durationSeconds ?? 0) : 0, t),
                    ].join(' · ')}
                  </div>
                </div>
              );
            })}
          </div>

          {damaged.length > 0 && (
            <div className="panel repair-summary" data-testid="repair-summary">
              <div className="statrow">
                <span>{t('port.repairWallet')}</span>
                <b>{money(wallet)}</b>
              </div>
              <div className="statrow">
                <span>{t('port.repairFee')}</span>
                <b>{money(changedTargets.length === 0 ? 0 : (repairQuoteQuery.data?.fee ?? 0))}</b>
              </div>
              <div className={`statrow total${repairOver ? ' over' : ''}`}>
                <span>{t('port.repairTotal')}</span>
                <b data-testid="repair-total">
                  {[money(repairTotalCost), formatDuration(repairTotalSeconds, t)].join(' · ')}
                </b>
              </div>
              {changedTargets.length === 0 && (
                <p className="sub">{t('port.repairNothingSelected')}</p>
              )}
              {repairOver && <p className="error-text">{t('port.repairOverBudget')}</p>}
              <div className="row-between" style={{ marginTop: 10 }}>
                <span className="stack-h">
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setRepairTargets(
                        Object.fromEntries(damagedInstalled.map((entry) => [entry.id, 100])),
                      )
                    }
                  >
                    {t('port.repairAllTo100')}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={changedTargets.length === 0}
                    onClick={() => setRepairTargets({})}
                  >
                    {t('port.repairReset')}
                  </button>
                </span>
                <button
                  type="button"
                  className="btn primary"
                  disabled={
                    changedTargets.length === 0 ||
                    repairQuoteQuery.data === undefined ||
                    // `keepPreviousData` shows the OLD plan's number while a new one is in
                    // flight (isPlaceholderData): confirming on it could look "affordable" from
                    // a stale, smaller cost and then fail once the server prices the real
                    // (current) targets. A background revalidation of an already-current quote
                    // is fine — only a genuinely stale (different-target) number blocks this.
                    repairQuoteQuery.isPlaceholderData ||
                    repairOver ||
                    repair.isPending
                  }
                  onClick={() => {
                    const quote = repairQuoteQuery.data;
                    if (quote === undefined) return;
                    setRepairPlan({
                      targets: changedTargets,
                      cost: quote.cost,
                      seconds: quote.durationSeconds,
                    });
                  }}
                >
                  {t('port.repairStart')}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'refuel' && (
        <section className="stack">
          <Gauge
            value={fuel}
            max={fuelCap}
            tone="fuel"
            ariaLabel={t('port.fuelBar')}
            label={t('port.refuelGauge', { fuel: Math.round(fuel), cap: Math.round(fuelCap) })}
          />
          <p className="sub">{t('port.refuelHint')}</p>
          {noTank ? (
            <p className="sub">{t('port.refuelNoTank')}</p>
          ) : tankFull ? (
            <p className="sub">{t('port.refuelFull')}</p>
          ) : (
            <div className="panel refuel-panel" data-testid="refuel-panel">
              <label className="lbl" htmlFor="refuel-amount">
                {t('port.refuelAmount')}
              </label>
              <input
                id="refuel-amount"
                type="range"
                min={0}
                max={tankSpace}
                step={1}
                value={wantedUnits}
                onChange={(event) => setRefuelUnits(Number(event.target.value))}
              />
              <div className="statrow">
                <span>
                  {t('port.refuelUnits', { units: wantedUnits })}
                  {unitPrice > 0 &&
                    ` · ${t('port.refuelUnitPrice', { price: unitPrice.toFixed(2) })}`}
                </span>
                <b className={refuelCost > wallet ? 'over' : undefined} data-testid="refuel-cost">
                  {money(refuelCost)}
                </b>
              </div>
              {!refuel.isPending && refuelCost > wallet && (
                <p className="error-text">{t('port.insufficient')}</p>
              )}
              <div className="row-between">
                <button
                  type="button"
                  className="btn"
                  disabled={wantedUnits === tankSpace}
                  onClick={() => setRefuelUnits(tankSpace)}
                >
                  {t('port.refuelFill')}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={wantedUnits === affordableUnits}
                  onClick={() => setRefuelUnits(affordableUnits)}
                >
                  {t('port.refuelAfford')}
                </button>
                <button
                  type="button"
                  className="btn primary"
                  disabled={wantedUnits <= 0 || refuel.isPending || broke || refuelCost > wallet}
                  onClick={() => refuel.mutate(wantedUnits)}
                >
                  {t('port.refuelBuy', { units: wantedUnits })}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'upgrade' && (
        <section className="stack" data-testid="upgrade">
          <p className="sub">{t('port.upgradeHelp')}</p>
          {(() => {
            const quotes = upgradeQuotesQuery.data;
            const eligible = upgradeCandidates.filter(
              (item) => quotes?.get(item.id)?.eligible === true,
            );
            if (quotes === undefined && upgradeCandidates.length > 0) {
              return <p className="sub">{t('loading')}</p>;
            }
            if (eligible.length === 0) {
              return <p className="sub">{t('port.upgradeNone')}</p>;
            }
            return (
              <div className="pcard-grid">
                {eligible.map((item) => {
                  const quote = quotes?.get(item.id);
                  if (quote === undefined || !quote.eligible) return null;
                  const name = partName(item);
                  const nextName =
                    quote.nextDisplayName !== undefined
                      ? pickLocalized(quote.nextDisplayName, i18n.language)
                      : '';
                  // Round-10 owner request: "Upgrade UI should show diff between current
                  // part and upgraded part" — the next tier doesn't exist as an owned
                  // instance yet, so it's a virtual PartInfoData (same trick Market uses
                  // for a catalog listing), replacing this exact instance.
                  const nextPartInfo: PartInfoData | undefined =
                    quote.nextCatalog !== undefined &&
                    quote.nextRarity !== undefined &&
                    quote.nextDisplayName !== undefined
                      ? {
                          displayName: quote.nextDisplayName,
                          description: quote.nextDescription ?? { en: '', 'pt-BR': '' },
                          rarity: quote.nextRarity,
                          catalog: quote.nextCatalog,
                          condition: 100,
                        }
                      : undefined;
                  const nextCompare: PartCompareContext | undefined =
                    nextPartInfo === undefined
                      ? undefined
                      : {
                          shipId: ship.id,
                          installedPartIds: installed.map((part) => part.id),
                          currentSheet: ship.sheet,
                          replaceCandidates: [
                            { partInstanceId: item.id, displayName: item.displayName },
                          ],
                        };
                  return (
                    <PartCard
                      key={item.id}
                      part={item}
                      price={quote.cost}
                      priceCaption={t('port.upgradeCost')}
                      infoExtra={
                        nextPartInfo !== undefined && (
                          <section className="upgrade-next" aria-label={t('port.upgradesTo', { name: nextName })}>
                            <h4>{t('port.upgradesTo', { name: nextName })}</h4>
                            <PartDetail part={nextPartInfo} compare={nextCompare} />
                          </section>
                        )
                      }
                      actions={
                        <>
                          <span className="sub">{t('port.upgradesTo', { name: nextName })}</span>
                          <button
                            type="button"
                            className="btn primary"
                            disabled={upgradePart.isPending || (quote.cost ?? 0) > wallet}
                            onClick={() =>
                              setUpgradeConfirm({
                                partInstanceId: item.id,
                                name,
                                nextName,
                                cost: quote.cost ?? 0,
                              })
                            }
                          >
                            {t('port.upgrade')}
                          </button>
                        </>
                      }
                    />
                  );
                })}
              </div>
            );
          })()}
        </section>
      )}

      {tab === 'scavenging' && (
        <section className="stack scav" data-testid="scavenging">
          <h2>{t('port.scav.title')}</h2>
          <p>{t('port.scav.what', { place: locationName(ship.currentLocationId) })}</p>
          {scavengeInfoQuery.data !== undefined && (
            <ul className="scav-facts">
              <li>
                {t('port.scav.time', {
                  minutes: Math.max(1, Math.round(scavengeInfoQuery.data.durationSeconds / 60)),
                })}
              </li>
              <li>{t('port.scav.risk', { zone: scavengeInfoQuery.data.zone })}</li>
              <li>
                {t('port.scav.nothing', {
                  percent: Math.round(scavengeInfoQuery.data.nothingChance * 100),
                })}
              </li>
              <li>
                {t('port.scav.quality', {
                  min: scavengeInfoQuery.data.qualityMin,
                  max: scavengeInfoQuery.data.qualityMax,
                })}
              </li>
              <li>
                {t('port.scav.finds', {
                  place: t(`port.scav.field.${scavengeInfoQuery.data.fieldType}`),
                })}
              </li>
              {scavengeInfoQuery.data.scrapPlace && <li>{t('port.scav.scrap')}</li>}
              <li>{t('port.scav.where')}</li>
            </ul>
          )}
          {shipHandicapped && (
            <p className="notice warn" data-testid="scavenge-handicap">
              {t('port.scav.handicap', { percent: Math.round(display.scavengeHandicap * 100) })}
            </p>
          )}
          {scavengeInfoQuery.data !== undefined && scavengeInfoQuery.data.retryAfterSeconds > 0 ? (
            <p className="notice" role="status">
              {t('port.scav.nextAttempt')}{' '}
              <Countdown
                until={scavengeRetryAt}
                onElapsed={() => void queryClient.invalidateQueries({ queryKey: ['scavenge'] })}
              />
            </p>
          ) : (
            <p className="sub">{t('port.scav.ready')}</p>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={scavenge.isPending || (scavengeInfoQuery.data?.retryAfterSeconds ?? 0) > 0}
            onClick={() => scavenge.mutate()}
          >
            {t('port.scavenge')}
          </button>
        </section>
      )}

      {tab === 'mining' && (
        <section className="stack scav" data-testid="mining-job">
          <h2>{t('port.mine.title')}</h2>
          <p className="sub">{t('port.mine.what')}</p>
          <button
            type="button"
            className="btn primary"
            disabled={mine.isPending}
            onClick={() => mine.mutate()}
          >
            {t('port.mine.action')}
          </button>
        </section>
      )}

      {!embedded && (
        <div className="actions" style={{ marginTop: 16 }}>
          <Link className="btn" to="/map">
            {t('report.backMap')}
          </Link>
          <Link className="btn" to="/profile">
            {t('profile.title')}
          </Link>
          <Link className="btn" to="/hangar">
            {t('nav.hangar')}
          </Link>
        </div>
      )}

      <Popup
        open={repairPlan !== null}
        title={repairPlan === null ? '' : t('port.repairConfirmTitle', { cost: repairPlan.cost })}
        onClose={() => setRepairPlan(null)}
      >
        {repairPlan !== null && (
          <div className="stack">
            <p>
              {t('port.repairQuote', {
                cost: repairPlan.cost,
                time: formatDuration(repairPlan.seconds, t),
              })}
            </p>
            {!repair.isPending && wallet < repairPlan.cost && (
              <p className="error-text">{t('port.insufficient')}</p>
            )}
            <button
              type="button"
              className="btn primary"
              disabled={repair.isPending || wallet < repairPlan.cost}
              onClick={() => repair.mutate(repairPlan.targets)}
            >
              {t('port.repairConfirm')}
            </button>
          </div>
        )}
      </Popup>

      <Popup
        open={upgradeConfirm !== null}
        title={
          upgradeConfirm === null
            ? ''
            : t('port.upgradeConfirmTitle', { cost: upgradeConfirm.cost })
        }
        onClose={() => setUpgradeConfirm(null)}
      >
        {upgradeConfirm !== null && (
          <div className="stack">
            <p>
              {t('port.upgradeQuote', {
                name: upgradeConfirm.name,
                nextName: upgradeConfirm.nextName,
                cost: upgradeConfirm.cost,
              })}
            </p>
            {!upgradePart.isPending && wallet < upgradeConfirm.cost && (
              <p className="error-text">{t('port.insufficient')}</p>
            )}
            <button
              type="button"
              className="btn primary"
              disabled={upgradePart.isPending || wallet < upgradeConfirm.cost}
              onClick={() => upgradePart.mutate(upgradeConfirm.partInstanceId)}
            >
              {t('port.upgradeConfirm')}
            </button>
          </div>
        )}
      </Popup>

      <Popup
        open={discardOpen}
        title={t('port.discardConfirmTitle', { count: damagedCount })}
        onClose={() => setDiscardOpen(false)}
      >
        <div className="stack">
          <p>{t('port.discardConfirmBody', { min: sellMin })}</p>
          <button
            type="button"
            className="btn danger"
            disabled={discard.isPending}
            onClick={() => discard.mutate()}
          >
            {t('port.discardConfirm')}
          </button>
        </div>
      </Popup>

      <Popup
        open={confirm !== null}
        title={
          confirm === null
            ? ''
            : confirm.price !== null
              ? t('port.sellQuote', { name: confirm.name, price: confirm.price })
              : t('port.sellConfirm', { name: confirm.name })
        }
        onClose={() => setConfirm(null)}
      >
        {confirm !== null && (
          <div className="stack">
            {confirm.price !== null && (
              <p>{t('port.balanceAfter', { balance: money(tradeBalance(confirm, wallet)) })}</p>
            )}
            {confirm.hint !== undefined && <p className="sub">{confirm.hint}</p>}
            <button
              type="button"
              className="btn primary"
              disabled={sellPart.isPending || sellMaterial.isPending}
              onClick={confirmTrade}
            >
              {t('port.sell')}
            </button>
          </div>
        )}
      </Popup>
    </>
  );

  if (embedded) return body;
  return (
    <main className="app" data-guided={guided ? '' : undefined}>
      {body}
    </main>
  );
}

function tradeBalance(confirm: ConfirmTrade, wallet: number): number {
  if (confirm.price === null) return wallet;
  return wallet + confirm.price;
}
