import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trans, useTranslation } from 'react-i18next';
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
import { markVisited } from '../tutorial/tutorial-store';
import { RescueBanner } from '../rescue/rescue-banner';
import { Popup } from '../../ui/Popup';
import { Countdown } from '../../ui/Countdown';
import { formatDuration } from '../../ui/duration';
import { Gauge, conditionTone } from '../../ui/Gauge';
import { ActionArt } from '../../ui/ActionArt';
import { PartThumb } from '../../ui/PartThumb';
import { PlaceBanner } from '../../ui/PlaceArt';
import { PortTabs } from '../../ui/PortTabs';
import { ActiveShipStage } from '../ship/active-ship-stage';
import { MarketPanel } from '../market/market-panel';
import { PartCard } from '../parts/part-card';
import { useDisplay } from '../../ui/display';
import { PartDetail } from '../parts/part-detail';
import { useBridgeResize } from './bridge-resize-panel';
import type { PartInfoData } from '../parts/part-detail';

// The seven tabs sit under three groups: what you buy, what the workshop does for the ship, and the
// jobs the ship does at this port. The tab state stays one `PortTabId`; the group is derived from it.
const PORT_GROUPS = [
  { id: 'buy', tabs: ['market', 'goods'] },
  { id: 'service', tabs: ['repair', 'refuel', 'upgrade'] },
  { id: 'work', tabs: ['scavenging', 'mining'] },
] as const;
type PortGroupId = (typeof PORT_GROUPS)[number]['id'];
type PortTabId = (typeof PORT_GROUPS)[number]['tabs'][number];

function groupOf(tab: PortTabId): PortGroupId {
  return PORT_GROUPS.find((group) => (group.tabs as readonly string[]).includes(tab))?.id ?? 'buy';
}

interface UpgradeConfirm {
  partInstanceId: string;
  name: string;
  nextName: string;
  /** Rarities of the part now and of what it becomes: their names are shown in their colours. */
  rarity: string;
  nextRarity: string;
  cost: number;
  /** What the upgrade also asks for besides credits, against what the pilot holds. */
  materials: { materialId: string; name: string; have: number; needed: number }[];
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
}

export function PortPage({ guided = false, embedded = false, onGoToShip }: PortPageProps) {
  const { t, i18n } = useTranslation();
  const { user, reloadProfile } = useAuthContext();
  const queryClient = useQueryClient();
  // `/port?tab=refuel` opens that tab (the board's "refuel first" link uses it).
  const [searchParams] = useSearchParams();
  const wantedTab = searchParams.get('tab');
  const [tab, setTab] = useState<PortTabId>(
    PORT_GROUPS.some((group) => (group.tabs as readonly string[]).includes(wantedTab ?? ''))
      ? (wantedTab as PortTabId)
      : 'market',
  );

  // The last tab opened in each group, so going back to a group lands where the pilot was.
  const [lastInGroup, setLastInGroup] = useState<Partial<Record<PortGroupId, PortTabId>>>({});
  const selectTab = (next: PortTabId) => {
    setTab(next);
    setLastInGroup((was) => ({ ...was, [groupOf(next)]: next }));
  };
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
  // Only places that can be mined at all get the Mining tab.
  const minableQuery = useQuery({
    queryKey: ['mineInfo', locationId],
    enabled: locationId !== undefined,
    queryFn: () => client.get<{ minable: boolean }>(`/v1/locations/${locationId ?? ''}/mine/info`),
  });
  const minable = minableQuery.data?.minable === true;
  useEffect(() => {
    if (tab === 'mining' && minableQuery.data?.minable === false) setTab('market');
  }, [tab, minableQuery.data]);
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
      client.post<PreviewResponse>(`/v1/ships/${ship?.id ?? ''}/preview`, {
        layout: ship?.layout ?? [],
      }),
  });
  const shipHandicapped =
    readinessQuery.data !== undefined &&
    (!readinessQuery.data.viability.viable || readinessQuery.data.viability.warnings.length > 0);
  // "With the ship" needs a ship that can actually fly and is free of a refit (the same two gates
  // the API applies to ship-mode); while the preview is loading, assume usable so the card does
  // not flash disabled. On foot needs neither, so it stays selectable either way.
  const shipUsable =
    (readinessQuery.data === undefined || readinessQuery.data.viability.viable) &&
    ship?.activity.kind !== 'repairing';
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

  // A place can switch services off (a drydock has no market and no upgrades): only an explicit `false`
  // closes one. The tabs of a closed service are not offered; the server refuses them too.
  const placeServices = worldQuery.data?.locations.find(
    (entry) => entry.id === ship?.currentLocationId,
  )?.services;
  const serviceClosed = (id: PortTabId): boolean =>
    (id === 'market' && placeServices?.buy === false) ||
    (id === 'goods' && placeServices?.sell === false) ||
    (id === 'upgrade' && placeServices?.upgrade === false);
  useEffect(() => {
    if (!serviceClosed(tab)) return;
    const next = PORT_GROUPS.flatMap((entry) => entry.tabs).find((id) => !serviceClosed(id));
    if (next !== undefined) setTab(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, placeServices]);

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
  // Upgrade tab: by default only what the pilot can pay for right now.
  const [onlyAffordable, setOnlyAffordable] = useState(true);
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

  // Expand / shrink of the pilot's bridge: its controls sit inside the bridge's own card.
  const bridgeResize = useBridgeResize({
    parts: upgradeCandidates,
    wallet,
    money,
    onChanged: (message) => {
      setActionError(null);
      setNotice(message);
      afterTrade();
    },
  });

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
      if (user !== null) markVisited(user.id, 'refuelled');
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
      if (user !== null) markVisited(user.id, 'repaired');
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

  // How many units of each material the pilot means to sell (default: the whole stack).
  const [sellAmounts, setSellAmounts] = useState<Record<string, number>>({});
  const sellAmountOf = (materialId: string, held: number): number =>
    Math.min(held, Math.max(1, sellAmounts[materialId] ?? held));

  const [discardOpen, setDiscardOpen] = useState(false);
  // Owner TODO ("rework discard damaged"): the confirm dialog offers to sell the scrap the
  // discard produces, right there in the same call, instead of leaving it in storage.
  const [discardSellScrap, setDiscardSellScrap] = useState(true);
  const discard = useMutation({
    mutationFn: () =>
      client.post<DiscardResponse>('/v1/inventory/discard', { sellScrap: discardSellScrap }),
    onSuccess: (response) => {
      setDiscardOpen(false);
      setActionError(null);
      setNotice(
        response.scrapSold > 0
          ? t('port.discardedSold', {
              count: response.discarded,
              scrap: response.scrapSold,
              credits: money(response.credits),
            })
          : t('port.discarded', { count: response.discarded }),
      );
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
  const [scavengeMode, setScavengeMode] = useState<'ship' | 'foot'>('ship');
  // No usable ship: the ship card is disabled, so make sure the mode is not left on "ship".
  useEffect(() => {
    if (!shipUsable && scavengeMode === 'ship') setScavengeMode('foot');
  }, [shipUsable, scavengeMode]);
  const scavenge = useMutation({
    mutationFn: () =>
      client.post<DispatchResponse>(`/v1/locations/${locationId ?? ''}/scavenge`, {
        mode: scavengeMode,
      }),
    onSuccess: () => {
      setActionError(null);
      if (user !== null) markVisited(user.id, 'worked');
      void queryClient.invalidateQueries({ queryKey: ['active'] });
      void queryClient.invalidateQueries({ queryKey: ['ships'] });
      void queryClient.invalidateQueries({ queryKey: ['scavenge'] });
      // Embedded, /hangar already IS the current route (a navigate() there would be a no-op),
      // so switch the host's own tab instead — same reason the "Install" link above does.
      if (embedded && onGoToShip !== undefined) {
        onGoToShip();
      } else {
        void navigate('/ship');
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
      if (user !== null) markVisited(user.id, 'worked');
      void queryClient.invalidateQueries({ queryKey: ['active'] });
      void queryClient.invalidateQueries({ queryKey: ['ships'] });
      if (embedded && onGoToShip !== undefined) {
        onGoToShip();
      } else {
        void navigate('/ship');
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
  const sellMin = marketQuery.data?.sellMinCondition ?? 1;
  const damagedCount = partsOnSale.filter((item) => item.condition < sellMin).length;
  const refuelCost = costOf(wantedUnits);
  const repairBadge = damaged.length > 0 ? damaged.length : undefined;

  // Two levels: the group (Buy, Service, Work) and, under it, that group's own tabs. Mining only
  // exists where the place can be mined, so Work may have a single tab (then no second row).
  const group = groupOf(tab);
  const visibleTabs = (ids: readonly PortTabId[]) =>
    ids.filter((id) => (id !== 'mining' || minable) && !serviceClosed(id));
  const groupTabs = visibleTabs(PORT_GROUPS.find((entry) => entry.id === group)?.tabs ?? []);
  const portTabsRow = (
    <div className="port-nav">
      <PortTabs
        label={t('port.groupsLabel')}
        tabs={PORT_GROUPS.filter((entry) => visibleTabs(entry.tabs).length > 0).map((entry) => ({
          id: entry.id,
          label: t(`port.groups.${entry.id}`),
          badge: entry.id === 'service' ? repairBadge : undefined,
        }))}
        activeId={group}
        onChange={(next) => {
          const target = PORT_GROUPS.find((entry) => entry.id === next);
          const remembered = lastInGroup[next as PortGroupId];
          const first = visibleTabs(target?.tabs ?? [])[0];
          const wanted =
            remembered !== undefined && visibleTabs([remembered]).length > 0 ? remembered : first;
          if (wanted !== undefined) selectTab(wanted);
        }}
      />
      {groupTabs.length > 1 && (
        <PortTabs
          variant="segment"
          label={t(`port.groups.${group}`)}
          tabs={groupTabs.map((id) => ({
            id,
            label: t(`port.tabs.${id}`),
            badge: id === 'repair' ? repairBadge : undefined,
          }))}
          activeId={tab}
          onChange={(next) => selectTab(next as PortTabId)}
        />
      )}
    </div>
  );

  const body = (
    <>
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

      {portTabsRow}

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
                        <Link className="btn" to="/ship">
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

          <h2 className="port-subhead">{t('port.materials')}</h2>
          {materials.length === 0 && <p className="sub">{t('inventory.noMaterials')}</p>}
          <div className="pcard-grid">
            {materials.map((holding) => {
              const name = pickLocalized(holding.displayName, i18n.language);
              const amount = sellAmountOf(holding.materialId, holding.quantity);
              const total = holding.unitPrice * amount;
              const materialTitle = [t('port.quantity', { quantity: holding.quantity }), name].join(
                ' ',
              );
              return (
                <article key={holding.materialId} className="pcard rarity-common">
                  <header className="pcard-head">
                    <h2 className="pcard-name">{materialTitle}</h2>
                    <p className="sub pcard-desc">
                      {pickLocalized(holding.description, i18n.language)}
                    </p>
                    <div className="pcard-price">
                      <b>{money(total)}</b>
                      <small>{t('port.unitPrice', { price: holding.unitPrice })}</small>
                    </div>
                  </header>
                  <footer className="pcard-actions">
                    {holding.quantity > 1 && (
                      <label className="sell-amount">
                        <span className="sub">{t('port.sellAmount')}</span>
                        <input
                          type="range"
                          min={1}
                          max={holding.quantity}
                          value={amount}
                          aria-label={t('port.sellAmountFor', { name })}
                          data-testid={`sell-amount-${holding.materialId}`}
                          onChange={(event) =>
                            setSellAmounts((current) => ({
                              ...current,
                              [holding.materialId]: Number(event.target.value),
                            }))
                          }
                        />
                        <b>{amount}</b>
                      </label>
                    )}
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
                          quantity: amount,
                        });
                      }}
                    >
                      {amount === holding.quantity
                        ? t('port.sellAll')
                        : t('port.sellSome', { count: amount })}
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
            planned={fuel + wantedUnits}
            label={
              wantedUnits > 0
                ? t('port.refuelGaugeAfter', {
                    fuel: Math.round(fuel),
                    add: wantedUnits,
                    after: Math.round(fuel + wantedUnits),
                    cap: Math.round(fuelCap),
                  })
                : t('port.refuelGauge', { fuel: Math.round(fuel), cap: Math.round(fuelCap) })
            }
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
              <div className="refuel-summary" data-testid="refuel-summary">
                <div>
                  <small>{t('port.refuelNow')}</small>
                  <b>{Math.round(fuel)}</b>
                </div>
                <div className="add">
                  <small>{t('port.refuelAdd')}</small>
                  <b>{t('port.refuelAddValue', { units: wantedUnits })}</b>
                </div>
                <div>
                  <small>{t('port.refuelAfter')}</small>
                  <b>
                    {t('port.refuelAfterValue', {
                      after: Math.round(fuel + wantedUnits),
                      cap: Math.round(fuelCap),
                    })}
                  </b>
                </div>
              </div>
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
          <div className="upgrade-rules" data-testid="upgrade-rules">
            <b>{t('port.upgradeRulesTitle')}</b>
            <ol>
              <li>{t('port.upgradeRule1')}</li>
              <li>{t('port.upgradeRule2')}</li>
              <li>{t('port.upgradeRule3')}</li>
            </ol>
          </div>
          {bridgeResize.dialog}
          {(() => {
            const quotes = upgradeQuotesQuery.data;
            // Why a part is NOT on the list: said plainly, with the way out.
            const blocked = (reason: string) =>
              upgradeCandidates.filter((item) => {
                const quote = quotes?.get(item.id);
                return quote?.eligible === false && quote.reason === reason;
              });
            const needRepair = blocked('NOT_FULL_CONDITION');
            const atTop = blocked('MAX_TIER');
            const noTier = blocked('NO_NEXT_TIER');
            const whyNot = (
              <div className="upgrade-why" data-testid="upgrade-why">
                {needRepair.length > 0 && (
                  <div>
                    <p>{t('port.upgradeBlockedRepair', { count: needRepair.length })}</p>
                    <ul className="upgrade-why-list">
                      {needRepair.map((item) => (
                        <li key={item.id}>
                          {t('port.upgradeBlockedPart', {
                            name: partName(item),
                            condition: Math.round(item.condition),
                          })}
                        </li>
                      ))}
                    </ul>
                    <button type="button" className="btn" onClick={() => setTab('repair')}>
                      {t('port.upgradeGoRepair')}
                    </button>
                  </div>
                )}
                {atTop.length > 0 && <p>{t('port.upgradeBlockedTop', { count: atTop.length })}</p>}
                {noTier.length > 0 && (
                  <p>{t('port.upgradeBlockedNoTier', { count: noTier.length })}</p>
                )}
              </div>
            );
            const upgradable = upgradeCandidates.filter(
              (item) => quotes?.get(item.id)?.eligible === true,
            );
            const eligible = onlyAffordable
              ? upgradable.filter((item) => (quotes?.get(item.id)?.cost ?? 0) <= wallet)
              : upgradable;
            if (quotes === undefined && upgradeCandidates.length > 0) {
              return <p className="sub">{t('loading')}</p>;
            }
            const filterChips = upgradable.length > 0 && (
              <div className="chips" role="group" aria-label={t('port.upgradeFilter')}>
                <button
                  type="button"
                  className={`chip${onlyAffordable ? ' on' : ''}`}
                  aria-pressed={onlyAffordable}
                  onClick={() => setOnlyAffordable((current) => !current)}
                >
                  {t('port.upgradeOnlyAffordable')}
                </button>
              </div>
            );
            // The bridge always has its card here (upgrade, expand or shrink live together on it),
            // even when it cannot be upgraded right now.
            const cards = [
              ...eligible,
              ...upgradeCandidates.filter(
                (item) =>
                  bridgeResize.isBridge(item) && !eligible.some((entry) => entry.id === item.id),
              ),
            ];
            if (cards.length === 0) {
              return (
                <>
                  {filterChips}
                  <p className="sub">
                    {upgradable.length > 0
                      ? t('port.upgradeNoneAffordable')
                      : upgradeCandidates.length > 0
                        ? t('port.upgradeNoneWhy')
                        : t('port.upgradeNone')}
                  </p>
                  {whyNot}
                </>
              );
            }
            return (
              <>
                {filterChips}
                {eligible.length === 0 && (
                  <p className="sub">
                    {upgradable.length > 0
                      ? t('port.upgradeNoneAffordable')
                      : t('port.upgradeNoneWhy')}
                  </p>
                )}
                <div className="pcard-grid">
                  {cards.map((item) => {
                    const quote = quotes?.get(item.id);
                    if (quote === undefined) return null;
                    if (!quote.eligible) {
                      // Not upgradable now (top rarity, needs repair...): the bridge still shows,
                      // with its own size controls.
                      return (
                        <PartCard
                          key={item.id}
                          part={item}
                          actions={
                            <div className="upgrade-actions">{bridgeResize.actionsFor(item)}</div>
                          }
                        />
                      );
                    }
                    const name = partName(item);
                    const nextName =
                      quote.nextDisplayName !== undefined
                        ? pickLocalized(quote.nextDisplayName, i18n.language)
                        : '';
                    // Say exactly what becomes what: "Small Fuel Tank · Common → Small Fuel Tank · Uncommon".
                    const fromTo = t('port.upgradeFromTo', {
                      from: `${name} · ${t(`parts.rarities.${item.rarity}`, { defaultValue: item.rarity })}`,
                      to: `${nextName} · ${t(`parts.rarities.${quote.nextRarity ?? ''}`, { defaultValue: quote.nextRarity ?? '' })}`,
                    });
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
                    return (
                      <PartCard
                        key={item.id}
                        part={item}
                        price={quote.cost}
                        priceCaption={t('port.upgradeCost')}
                        hoverPart={nextPartInfo}
                        infoExtra={
                          nextPartInfo !== undefined && (
                            <section className="upgrade-next" aria-label={fromTo}>
                              <h4>{fromTo}</h4>
                              <PartDetail part={nextPartInfo} versus={item} />
                            </section>
                          )
                        }
                        actions={
                          <div className="upgrade-actions">
                            <span className="sub">{fromTo}</span>
                            {(quote.materials ?? []).length > 0 && (
                              <ul className="upgrade-materials" data-testid="upgrade-materials">
                                {(quote.materials ?? []).map((need) => (
                                  <li
                                    key={need.materialId}
                                    className={need.have >= need.needed ? 'req-met' : 'req-unmet'}
                                  >
                                    {t('port.upgradeMaterial', {
                                      name: pickLocalized(need.displayName, i18n.language),
                                      have: need.have,
                                      needed: need.needed,
                                    })}
                                  </li>
                                ))}
                              </ul>
                            )}
                            <button
                              type="button"
                              className="btn primary"
                              disabled={
                                upgradePart.isPending ||
                                (quote.cost ?? 0) > wallet ||
                                (quote.materials ?? []).some((need) => need.have < need.needed)
                              }
                              onClick={() =>
                                setUpgradeConfirm({
                                  partInstanceId: item.id,
                                  name,
                                  nextName,
                                  rarity: item.rarity,
                                  nextRarity: quote.nextRarity ?? item.rarity,
                                  cost: quote.cost ?? 0,
                                  materials: (quote.materials ?? []).map((need) => ({
                                    materialId: need.materialId,
                                    name: pickLocalized(need.displayName, i18n.language),
                                    have: need.have,
                                    needed: need.needed,
                                  })),
                                })
                              }
                            >
                              {t('port.upgrade')}
                            </button>
                            {bridgeResize.actionsFor(item)}
                          </div>
                        }
                      />
                    );
                  })}
                </div>
                {whyNot}
              </>
            );
          })()}
        </section>
      )}

      {tab === 'scavenging' && (
        <section className="stack scav" data-testid="scavenging">
          <header className="action-hero">
            <ActionArt kind={scavengeMode === 'foot' ? 'scavenge-foot' : 'scavenge-ship'} />
            <div>
              <h2>{t('port.scav.title')}</h2>
              <p className="sub">
                {t('port.scav.what', { place: locationName(ship.currentLocationId) })}
              </p>
            </div>
          </header>
          {scavengeInfoQuery.data !== undefined && (
            <ul className="action-tiles" data-testid="scav-tiles">
              <li>
                <small>{t('port.scav.tile.time')}</small>
                <b>
                  {t('port.scav.tile.timeValue', {
                    minutes: Math.max(
                      1,
                      Math.round(
                        (scavengeMode === 'foot'
                          ? scavengeInfoQuery.data.footDurationSeconds
                          : scavengeInfoQuery.data.durationSeconds) / 60,
                      ),
                    ),
                  })}
                </b>
              </li>
              <li>
                <small>{t('port.scav.tile.risk')}</small>
                <b>
                  {scavengeMode === 'foot'
                    ? t('port.scav.tile.riskFoot', { zone: scavengeInfoQuery.data.zone })
                    : t('port.scav.tile.riskValue', { zone: scavengeInfoQuery.data.zone })}
                </b>
              </li>
              <li>
                <small>{t('port.scav.tile.nothing')}</small>
                <b>
                  {t('port.scav.tile.percent', {
                    value: Math.round((1 - scavengeInfoQuery.data.nothingChance) * 100),
                  })}
                </b>
              </li>
              <li>
                <small>{t('port.scav.tile.quality')}</small>
                <b>
                  {t('port.scav.tile.range', {
                    min: scavengeInfoQuery.data.qualityMin,
                    max: scavengeInfoQuery.data.qualityMax,
                  })}
                </b>
              </li>
            </ul>
          )}
          <fieldset className="scav-modes" data-testid="scavenge-mode">
            <legend>{t('port.scav.modeTitle')}</legend>
            {(['ship', 'foot'] as const).map((mode) => (
              <label
                key={mode}
                className={`scav-mode action-card${scavengeMode === mode ? ' on' : ''}`}
              >
                <input
                  type="radio"
                  name="scavenge-mode"
                  value={mode}
                  checked={scavengeMode === mode}
                  disabled={mode === 'ship' && !shipUsable}
                  onChange={() => setScavengeMode(mode)}
                />
                <ActionArt kind={mode === 'foot' ? 'scavenge-foot' : 'scavenge-ship'} />
                <span>
                  <b>{t(`port.scav.mode.${mode}.name`)}</b>
                  <span className="sub">
                    {t(`port.scav.mode.${mode}.hint`, {
                      percent: Math.round(display.scavengeFootFactor * 100),
                    })}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          {!shipUsable && (
            <p className="notice warn" data-testid="scavenge-no-ship">
              {t(
                ship?.activity.kind === 'repairing'
                  ? 'port.scav.shipRepairing'
                  : 'port.scav.noShip',
              )}
            </p>
          )}
          {scavengeMode === 'foot' && (
            <p className="notice warn" data-testid="scavenge-foot">
              {t('port.scav.footNotice', { percent: Math.round(display.scavengeFootFactor * 100) })}
            </p>
          )}
          {scavengeMode === 'ship' && shipHandicapped && (
            <p className="notice warn" data-testid="scavenge-handicap">
              {t('port.scav.handicap', { percent: Math.round(display.scavengeHandicap * 100) })}
            </p>
          )}
          {scavengeInfoQuery.data !== undefined && (
            <details className="scav-more">
              <summary>{t('port.scav.more')}</summary>
              <ul className="scav-facts">
                <li>
                  {t(scavengeMode === 'foot' ? 'port.scav.riskFoot' : 'port.scav.risk', {
                    zone: scavengeInfoQuery.data.zone,
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
            </details>
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
          <div className="action-cta">
            <button
              type="button"
              className="btn primary"
              disabled={
                scavenge.isPending ||
                (scavengeInfoQuery.data?.retryAfterSeconds ?? 0) > 0 ||
                (scavengeMode === 'ship' && !shipUsable)
              }
              onClick={() => scavenge.mutate()}
            >
              {t(scavengeMode === 'foot' ? 'port.scavengeFoot' : 'port.scavenge')}
            </button>
          </div>
        </section>
      )}

      {tab === 'mining' && minable && (
        <section className="stack scav" data-testid="mining-job">
          <header className="action-hero">
            <ActionArt kind="mining" />
            <div>
              <h2>{t('port.mine.title')}</h2>
              <p className="sub">{t('port.mine.what')}</p>
            </div>
          </header>
          <div className="action-cta">
            {/* What is dug is kept in the cargo hold: with none, the run would come back empty. */}
            {ship !== undefined && ship.sheet.crg < 1 && (
              <p className="warn-text" role="status" data-testid="mine-no-hold">
                {t('hangar.problems.NO_CARGO_HOLD')}
              </p>
            )}
            <button
              type="button"
              className="btn primary"
              disabled={mine.isPending || (ship !== undefined && ship.sheet.crg < 1)}
              onClick={() => mine.mutate()}
            >
              {t('port.mine.action')}
            </button>
          </div>
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
          <Link className="btn" to="/ship">
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
              <Trans
                i18nKey="port.upgradeQuote"
                values={{
                  name: upgradeConfirm.name,
                  nextName: upgradeConfirm.nextName,
                  cost: upgradeConfirm.cost,
                }}
                components={{
                  from: (
                    <b className={`rarity-name rarity-${upgradeConfirm.rarity.toLowerCase()}`} />
                  ),
                  to: (
                    <b
                      className={`rarity-name rarity-${upgradeConfirm.nextRarity.toLowerCase()}`}
                    />
                  ),
                }}
              />
            </p>
            <ul className="upgrade-price" data-testid="upgrade-price">
              <li className={wallet >= upgradeConfirm.cost ? 'req-met' : 'req-unmet'}>
                {t('port.upgradePriceCredits', {
                  cost: money(upgradeConfirm.cost),
                  have: money(wallet),
                })}
              </li>
              {upgradeConfirm.materials.map((need) => (
                <li
                  key={need.materialId}
                  className={need.have >= need.needed ? 'req-met' : 'req-unmet'}
                >
                  {t('port.upgradeMaterial', {
                    name: need.name,
                    have: need.have,
                    needed: need.needed,
                  })}
                </li>
              ))}
            </ul>
            {!upgradePart.isPending && wallet < upgradeConfirm.cost && (
              <p className="error-text">{t('port.insufficient')}</p>
            )}
            <button
              type="button"
              className="btn primary"
              disabled={
                upgradePart.isPending ||
                wallet < upgradeConfirm.cost ||
                upgradeConfirm.materials.some((need) => need.have < need.needed)
              }
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
          <label className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={discardSellScrap}
              onChange={(event) => setDiscardSellScrap(event.target.checked)}
            />
            {t('port.discardSellScrap')}
          </label>
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
