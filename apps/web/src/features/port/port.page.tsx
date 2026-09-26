import { useMemo, useState } from 'react';
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

const PORT_TABS = ['market', 'goods', 'repair', 'refuel', 'scavenging'] as const;
type PortTabId = (typeof PORT_TABS)[number];

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
}

export function PortPage({ guided = false }: PortPageProps) {
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
  const wantedUnits = Math.min(refuelUnits ?? tankSpace, tankSpace);
  const refuelQuoteQuery = useQuery({
    queryKey: ['refuelQuote', ship?.id, wantedUnits],
    enabled: tab === 'refuel' && ship !== undefined && wantedUnits > 0,
    placeholderData: keepPreviousData,
    queryFn: () =>
      client.post<RefuelQuoteResponse>(`/v1/ships/${ship?.id ?? ''}/refuel/quote`, {
        mode: 'partial',
        amount: wantedUnits,
      }),
  });
  const refuel = useMutation({
    mutationFn: (units: number) =>
      client.post<RefuelResponse>(
        `/v1/ships/${ship?.id ?? ''}/refuel`,
        units >= tankSpace ? { mode: 'full' } : { mode: 'partial', amount: units },
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
      void navigate('/transit');
    },
    onError: (error) => {
      setActionError(errorText(t, error, t('port.failed')));
      void queryClient.invalidateQueries({ queryKey: ['scavenge'] });
    },
  });

  if (
    marketQuery.isLoading ||
    inventoryQuery.isLoading ||
    materialsQuery.isLoading ||
    shipsQuery.isLoading ||
    worldQuery.isLoading
  ) {
    return (
      <main className="app" data-guided={guided ? '' : undefined}>
        {t('loading')}
      </main>
    );
  }

  if (ship === undefined) {
    return (
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
  const tankFull = fuel >= fuelCap;

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
  const refuelCost = wantedUnits <= 0 ? 0 : (refuelQuoteQuery.data?.cost ?? 0);
  const repairBadge = damaged.length > 0 ? damaged.length : undefined;

  return (
    <main className="app" data-guided={guided ? '' : undefined}>
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

      <PlaceBanner placeId={ship.currentLocationId} className="port-banner">
        <h2>{locationName(ship.currentLocationId)}</h2>
      </PlaceBanner>

      <ActiveShipStage size="compact" />

      <RescueBanner />

      <PortTabs
        tabs={PORT_TABS.map((id) => ({
          id,
          label: t(`port.tabs.${id}`),
          badge: id === 'repair' ? repairBadge : undefined,
        }))}
        activeId={tab}
        onChange={(next) => setTab(next as PortTabId)}
      />

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
          <MarketPanel locationId={ship.currentLocationId} onNotice={setNotice} />
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
                      <Link className="btn" to="/hangar">
                        {t('inventory.install')}
                      </Link>
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
          {tankFull ? (
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
                <span>{t('port.refuelUnits', { units: wantedUnits })}</span>
                <b className={refuelCost > wallet ? 'over' : undefined} data-testid="refuel-cost">
                  {money(refuelCost)}
                </b>
              </div>
              {refuelCost > wallet && <p className="error-text">{t('port.insufficient')}</p>}
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
            {wallet < repairPlan.cost && <p className="error-text">{t('port.insufficient')}</p>}
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
    </main>
  );
}

function tradeBalance(confirm: ConfirmTrade, wallet: number): number {
  if (confirm.price === null) return wallet;
  return wallet + confirm.price;
}
