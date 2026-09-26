import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client, serverNow } from '../../api/client';
import { errorText, priceChangedActualOf } from '../../api/errors';
import { useIntentKey } from '../../api/intent-key';
import type {
  InventoryItem,
  MarketResponse,
  MaterialsResponse,
  RefuelResponse,
  RepairQuoteResponse,
  RepairStartResponse,
  ScavengeInfo,
  ScavengeResponse,
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
import { Gauge, conditionTone } from '../../ui/Gauge';
import { PortTabs } from '../../ui/PortTabs';
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

  const refuel = useMutation({
    mutationFn: () =>
      client.post<RefuelResponse>(
        `/v1/ships/${ship?.id ?? ''}/refuel`,
        { mode: 'full' },
        { idempotencyKey: refuelKey.keyFor(`refuel:${ship?.id ?? ''}`) },
      ),
    onSuccess: (response) => {
      refuelKey.clear();
      setActionError(null);
      setNotice(t('port.refueled', { units: response.units, cost: response.cost }));
      afterTrade();
    },
    onError: (error) => setActionError(errorText(t, error, t('port.failed'))),
  });

  // Repair is priced by the server before it is charged: the player sees the exact cost
  // and duration in a confirmation, and only then does the paying request go out.
  const repairQuote = useMutation({
    mutationFn: (targets: RepairTarget[]) =>
      client
        .post<RepairQuoteResponse>(`/v1/ships/${ship?.id ?? ''}/repair/quote`, { targets })
        .then((quote) => ({ targets, quote })),
    onSuccess: ({ targets, quote }) => {
      setActionError(null);
      setNotice(null);
      setRepairPlan({ targets, cost: quote.cost, seconds: quote.durationSeconds });
    },
    onError: (error) => setActionError(errorText(t, error, t('port.failed'))),
  });

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
          seconds: response.durationSeconds,
        }),
      );
      afterTrade();
    },
    onError: (error) => {
      setRepairPlan(null);
      setActionError(errorText(t, error, t('port.failed')));
    },
  });

  const scavenge = useMutation({
    mutationFn: () => client.post<ScavengeResponse>(`/v1/locations/${locationId ?? ''}/scavenge`),
    onSuccess: (response) => {
      setActionError(null);
      if (response.part !== null) {
        setNotice(
          t('port.scavFound', {
            part: pickLocalized(response.part.displayName, i18n.language),
            condition: response.part.condition,
          }),
        );
      } else {
        setNotice(t('port.scavNone', { seconds: response.cooldownSeconds }));
      }
      afterTrade();
      void queryClient.invalidateQueries({ queryKey: ['scavenge'] });
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

  const startRepair = (targets: RepairTarget[]) => {
    if (targets.length === 0) return;
    repairQuote.mutate(targets);
  };

  // When the next attempt opens, on the server clock (the info endpoint says how long is left).
  const scavengeRetryAt = new Date(
    serverNow() + (scavengeInfoQuery.data?.retryAfterSeconds ?? 0) * 1000,
  ).toISOString();
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
          <div className="pcard-grid">
            {partsOnSale.map((item) => {
              const offer = sellOfferOf(item.id);
              return (
                <PartCard
                  key={item.id}
                  part={item}
                  price={offer ?? undefined}
                  priceCaption={t('port.portPays')}
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
        <section className="stack">
          {damaged.length === 0 && <p className="sub">{t('port.repairNoDamage')}</p>}
          <div className="repair-list">
            {damaged.map((item) => {
              const target = repairTargets[item.id] ?? 100;
              const condition = Math.round(item.condition);
              const name = partName(item);
              // Two identical parts (two Cargo Holds) are told apart by a stable number.
              const same = damaged.filter((entry) => partName(entry) === name);
              const suffix = same.length > 1 ? ` #${same.indexOf(item) + 1}` : '';
              const rowName = `${name}${suffix}`;
              return (
                <div key={item.id} className="repair-row">
                  <div className="rname">
                    {rowName}
                    <small>{t(`hangar.partClasses.${item.catalog.partClass}`)}</small>
                  </div>
                  <Gauge
                    value={condition}
                    max={100}
                    planned={target}
                    tone={conditionTone(condition)}
                    ariaLabel={`${name}${suffix}: ${t('port.conditionNow', { value: condition })}`}
                    label={
                      target > condition
                        ? t('port.conditionToTarget', { from: condition, to: target })
                        : t('port.conditionNow', { value: condition })
                    }
                  />
                  <input
                    type="range"
                    min={condition}
                    max={100}
                    step={1}
                    value={target}
                    aria-label={`${name}${suffix} ${t('port.repairSlider', { value: target })}`}
                    onChange={(event) =>
                      setRepairTargets((current) => ({
                        ...current,
                        [item.id]: Number(event.target.value),
                      }))
                    }
                  />
                </div>
              );
            })}
          </div>
          <div className="row-between">
            <button
              type="button"
              className="btn"
              disabled={damaged.length === 0 || repair.isPending || repairQuote.isPending}
              onClick={() =>
                startRepair(
                  damaged.map((item) => ({
                    partInstanceId: item.id,
                    toCondition: repairTargets[item.id] ?? 100,
                  })),
                )
              }
            >
              {t('port.repairStart')}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={damaged.length === 0 || repair.isPending || repairQuote.isPending}
              onClick={() =>
                startRepair(damaged.map((item) => ({ partInstanceId: item.id, toCondition: 100 })))
              }
            >
              {t('port.repairAll')}
            </button>
          </div>
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
          {tankFull && <p className="sub">{t('port.refuelFull')}</p>}
          <button
            type="button"
            className="btn primary"
            disabled={tankFull || refuel.isPending || broke}
            onClick={() => refuel.mutate()}
          >
            {t('port.refuelFill')}
          </button>
        </section>
      )}

      {tab === 'scavenging' && (
        <section className="stack scav" data-testid="scavenging">
          <h2>{t('port.scav.title')}</h2>
          <p>{t('port.scav.what', { place: locationName(ship.currentLocationId) })}</p>
          {scavengeInfoQuery.data !== undefined && (
            <ul className="scav-facts">
              <li>
                {t('port.scav.chance', {
                  percent: Math.round(scavengeInfoQuery.data.dropChance * 100),
                  place: t(`port.scav.field.${scavengeInfoQuery.data.fieldType}`),
                })}
              </li>
              <li>
                {t('port.scav.quality', {
                  min: scavengeInfoQuery.data.qualityMin,
                  max: scavengeInfoQuery.data.qualityMax,
                })}
              </li>
              <li>
                {t('port.scav.cooldown', {
                  minutes: Math.max(1, Math.round(scavengeInfoQuery.data.cooldownSeconds / 60)),
                })}
              </li>
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
            <p>{t('port.repairQuote', { cost: repairPlan.cost, seconds: repairPlan.seconds })}</p>
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
