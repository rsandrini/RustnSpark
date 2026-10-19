import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import { errorCodeOf, errorText, priceChangedActualOf } from '../../api/errors';
import { useIntentKey } from '../../api/intent-key';
import type { BuyResponse, MarketListing, MarketResponse, ShipSheet } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { Popup } from '../../ui/Popup';
import { useAuthContext } from '../auth/auth.context';
import { PartCard } from '../parts/part-card';
import { ShipNeedsList, isShield, lackingParts } from './ship-needs';
import { rankReplaceCandidates, type InstalledPartForCompare } from '../parts/part-compare-match';
import type { PartCompareContext } from '../parts/part-detail';
import { classOfGroup, matchesPartGroup, partGroupOf } from '../parts/part-group';

interface ConfirmBuy {
  name: string;
  price: number;
  listingId: string;
  hint?: string;
}

type Condition = 'all' | 'new' | 'used';
type SortKey = 'name' | 'priceAsc' | 'priceDesc' | 'condition';

export interface MarketPanelProps {
  locationId: string;
  /** Pre-selects a part-class chip (e.g. from a viability hint); `null` shows everything. */
  presetClass?: string | null;
  /** When the host page shows notices itself (the Port does), purchases report here instead. */
  onNotice?: (message: string | null) => void;
  /** Show the pilot's credits above the offers (the Hangar has no wallet header of its own). */
  showBalance?: boolean;
  /** Compare column (round-2 plan §5b item 4): the ship to compare against, its currently
      installed parts, and its current sheet. Omitted entirely (no host-side ship context) just
      means listings show no compare column — buying still works exactly the same either way. */
  shipId?: string;
  installedParts?: readonly InstalledPartForCompare[];
  currentSheet?: ShipSheet;
  /** Show the "Your ship needs" note above the offers (default). The Hangar shows it itself, on the Ship screen. */
  showNeeds?: boolean;
}

// The buy side of a port: a filterable list of offers with the full explanation of each part
// one click away, and the confirm-then-buy flow. Used by the Port's market tab and by the
// Hangar's Store tab, so both behave (and read) the same.
export function MarketPanel({
  locationId,
  presetClass = null,
  onNotice,
  showBalance = false,
  shipId,
  installedParts,
  currentSheet,
  showNeeds = true,
}: MarketPanelProps) {
  const { t, i18n } = useTranslation();
  const { user, reloadProfile } = useAuthContext();
  const queryClient = useQueryClient();
  const buyKey = useIntentKey();
  const [confirm, setConfirm] = useState<ConfirmBuy | null>(null);
  const [ownNotice, setOwnNotice] = useState<string | null>(null);
  const notice = onNotice === undefined ? ownNotice : null;
  const setNotice = onNotice ?? setOwnNotice;
  const [actionError, setActionError] = useState<string | null>(null);
  const [partClass, setPartClass] = useState<string | null>(presetClass);
  const [search, setSearch] = useState('');
  const [condition, setCondition] = useState<Condition>('all');
  const [sort, setSort] = useState<SortKey>('priceAsc');
  const [affordableOnly, setAffordableOnly] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  const [dismissedNeeds, setDismissedNeeds] = useState<ReadonlySet<string>>(new Set());
  const [rarity, setRarity] = useState<string>('all');
  const [size, setSize] = useState<string>('all');

  useEffect(() => {
    setPartClass(presetClass);
  }, [presetClass]);

  const marketQuery = useQuery({
    queryKey: ['market', locationId],
    queryFn: () => client.get<MarketResponse>(`/v1/locations/${locationId}/market`),
  });

  const wallet = user?.credits ?? 0;
  const money = (value: number) => `${new Intl.NumberFormat(i18n.language).format(value)} ¢`;

  const buy = useMutation({
    mutationFn: (args: { listingId: string; expectedPrice: number }) =>
      client.post<BuyResponse>('/v1/market/buy', args, {
        idempotencyKey: buyKey.keyFor(`${args.listingId}:${args.expectedPrice}`),
      }),
    onSuccess: (response) => {
      buyKey.clear();
      const boughtName = confirm?.name ?? '';
      setConfirm(null);
      setActionError(null);
      setNotice(t('port.bought', { name: boughtName, price: response.price }));
      // Profile only (wallet): a session refresh per trade would rotate the refresh token.
      void reloadProfile();
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['market'] });
      void queryClient.invalidateQueries({ queryKey: ['ships'] });
    },
    // A stale quote: the server's actual price replaces the one on screen and the player
    // confirms again (a new expectedPrice is a new action, so it gets a new key).
    onError: (error) => {
      const actual = priceChangedActualOf(error);
      if (actual !== undefined && confirm !== null) {
        setActionError(null);
        setConfirm({ ...confirm, price: actual, hint: t('port.priceUpdated', { price: actual }) });
        void queryClient.invalidateQueries({ queryKey: ['market'] });
        return;
      }
      if (errorCodeOf(error) === 'LISTING_SOLD') {
        // Someone took the used part first: close the dialog and redraw the shelf without it.
        setConfirm(null);
        void queryClient.invalidateQueries({ queryKey: ['market'] });
      }
      setActionError(errorText(t, error, t('port.failed')));
    },
  });

  // A bridge is not something you shop for: every ship has exactly one and it comes with the kit
  // (or the restart kit), so it never appears among the offers.
  const listings = useMemo(
    () => (marketQuery.data?.listings ?? []).filter((l) => l.catalog.partClass !== 'BRIDGE'),
    [marketQuery.data],
  );
  // The chips are the shop groups (a class split into its kinds where it holds several), in
  // class order; rarity and size narrow the list further.
  const classes = useMemo(
    () =>
      Array.from(
        new Set(
          listings.map((listing) =>
            partGroupOf(listing.catalog.partType, listing.catalog.partClass),
          ),
        ),
      ).sort((a, b) => classOfGroup(a).localeCompare(classOfGroup(b)) || a.localeCompare(b)),
    [listings],
  );
  const sizeOf = (listing: MarketListing) => `${listing.catalog.w}x${listing.catalog.h}`;
  const rarities = useMemo(
    () => Array.from(new Set(listings.map((listing) => listing.rarity))),
    [listings],
  );
  const sizes = useMemo(
    () =>
      Array.from(
        new Set(listings.map((listing) => `${listing.catalog.w}x${listing.catalog.h}`)),
      ).sort((a, b) => {
        const area = (value: string) =>
          value.split('x').reduce((product, side) => product * Number(side), 1);
        return area(a) - area(b) || a.localeCompare(b);
      }),
    [listings],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const nameOf = (listing: MarketListing) => pickLocalized(listing.displayName, i18n.language);
    const filtered = listings.filter((listing) => {
      if (!matchesPartGroup(listing.catalog.partType, listing.catalog.partClass, partClass)) {
        return false;
      }
      if (affordableOnly && listing.price > wallet) return false;
      if (rarity !== 'all' && listing.rarity !== rarity) return false;
      if (size !== 'all' && sizeOf(listing) !== size) return false;
      if (condition === 'new' && listing.kind !== 'catalog') return false;
      if (condition === 'used' && listing.kind !== 'used') return false;
      if (needle === '') return true;
      const haystack = `${nameOf(listing)} ${pickLocalized(listing.description, i18n.language)}`;
      return haystack.toLowerCase().includes(needle);
    });
    const compare: Record<SortKey, (a: MarketListing, b: MarketListing) => number> = {
      name: (a, b) => nameOf(a).localeCompare(nameOf(b), i18n.language),
      priceAsc: (a, b) => a.price - b.price,
      priceDesc: (a, b) => b.price - a.price,
      condition: (a, b) => b.condition - a.condition,
    };
    return [...filtered].sort(compare[sort]);
  }, [
    listings,
    partClass,
    rarity,
    size,
    condition,
    search,
    sort,
    affordableOnly,
    wallet,
    i18n.language,
  ]);

  // What the ship lacks, read off its sheet (no server call): each need names the class of part
  // that would fix it and only shows when this shelf has such parts.
  const needs = useMemo(
    () =>
      lackingParts(currentSheet, installedParts).filter(
        (need) =>
          !dismissedNeeds.has(need.id) &&
          listings.some((listing) =>
            need.id === 'shield'
              ? isShield(listing.catalog)
              : listing.catalog.partClass === need.partClass,
          ),
      ),
    [currentSheet, installedParts, listings, dismissedNeeds],
  );
  const extraFilters = [rarity !== 'all', size !== 'all', condition !== 'all'].filter(
    Boolean,
  ).length;

  const insufficient = confirm !== null && wallet < confirm.price;

  const compareContextFor = (listing: MarketListing): PartCompareContext | undefined => {
    if (shipId === undefined || currentSheet === undefined) return undefined;
    const candidates =
      installedParts !== undefined ? rankReplaceCandidates(installedParts, listing) : [];
    return {
      shipId,
      installedPartIds: (installedParts ?? []).map((part) => part.id),
      currentSheet,
      replaceCandidates: candidates.map((part) => ({
        partInstanceId: part.id,
        displayName: part.displayName,
      })),
    };
  };

  return (
    <section className="stack market-panel">
      {showBalance && (
        <p className="balance" data-testid="store-balance">
          <span className="muted">{t('port.wallet')}</span> <b>{money(wallet)}</b>
        </p>
      )}

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

      <ShipNeedsList
        needs={showNeeds ? needs : []}
        onShow={(need) => setPartClass(need.partClass)}
        onDismiss={(need) => setDismissedNeeds((was) => new Set([...was, need.id]))}
      />

      <div className="market-filters" role="search">
        <div className="market-controls">
          <input
            className="input"
            type="search"
            value={search}
            placeholder={t('market.searchPlaceholder')}
            aria-label={t('market.search')}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="input"
            value={sort}
            aria-label={t('market.sort')}
            onChange={(event) => setSort(event.target.value as SortKey)}
          >
            <option value="priceAsc">{t('market.sortPriceAsc')}</option>
            <option value="priceDesc">{t('market.sortPriceDesc')}</option>
            <option value="name">{t('market.sortName')}</option>
            <option value="condition">{t('market.sortCondition')}</option>
          </select>
          <button
            type="button"
            className={`chip${affordableOnly ? ' on' : ''}`}
            aria-pressed={affordableOnly}
            onClick={() => setAffordableOnly((was) => !was)}
          >
            {t('market.affordable')}
          </button>
          <button type="button" className="btn" onClick={() => setMoreFilters(true)}>
            {t('market.moreFilters')}
            {extraFilters > 0 && <span className="count">{extraFilters}</span>}
          </button>
        </div>
        <div className="chips" role="group" aria-label={t('market.filterByType')}>
          <button
            type="button"
            className={`chip${partClass === null ? ' on' : ''}`}
            aria-pressed={partClass === null}
            onClick={() => setPartClass(null)}
          >
            {t('market.all')}
          </button>
          {partClass !== null && !classes.includes(partClass) && (
            <button
              type="button"
              className="chip on"
              aria-pressed="true"
              onClick={() => setPartClass(null)}
            >
              {t(`hangar.partClasses.${partClass}`, { defaultValue: partClass })}
              {t('market.chipClear')}
            </button>
          )}
          {classes.map((cls) => (
            <button
              key={cls}
              type="button"
              className={`chip${partClass === cls ? ' on' : ''}`}
              aria-pressed={partClass === cls}
              onClick={() => setPartClass(cls)}
            >
              {t(`hangar.partGroups.${cls}`, { defaultValue: t(`hangar.partClasses.${cls}`) })}
            </button>
          ))}
        </div>
      </div>

      <Popup
        open={moreFilters}
        title={t('market.moreFilters')}
        onClose={() => setMoreFilters(false)}
      >
        <div className="stack">
          <label className="field">
            <span className="lbl">{t('market.rarity')}</span>
            <select
              className="input"
              value={rarity}
              aria-label={t('market.rarity')}
              onChange={(event) => setRarity(event.target.value)}
            >
              <option value="all">{t('market.rarityAll')}</option>
              {rarities.map((value) => (
                <option key={value} value={value}>
                  {t(`parts.rarities.${value}`, { defaultValue: value })}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="lbl">{t('market.size')}</span>
            <select
              className="input"
              value={size}
              aria-label={t('market.size')}
              onChange={(event) => setSize(event.target.value)}
            >
              <option value="all">{t('market.sizeAll')}</option>
              {sizes.map((value) => (
                <option key={value} value={value}>
                  {value.replace('x', '×')}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="lbl">{t('market.condition')}</span>
            <select
              className="input"
              value={condition}
              aria-label={t('market.condition')}
              onChange={(event) => setCondition(event.target.value as Condition)}
            >
              <option value="all">{t('market.conditionAll')}</option>
              <option value="new">{t('market.conditionNew')}</option>
              <option value="used">{t('market.conditionUsed')}</option>
            </select>
          </label>
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setRarity('all');
                setSize('all');
                setCondition('all');
              }}
            >
              {t('market.clearFilters')}
            </button>
            <button type="button" className="btn primary" onClick={() => setMoreFilters(false)}>
              {t('market.applyFilters')}
            </button>
          </div>
        </div>
      </Popup>

      {listings.length === 0 && marketQuery.isSuccess && (
        <p className="sub">{t('port.marketEmpty')}</p>
      )}
      {listings.length > 0 && visible.length === 0 && (
        <p className="sub">{t('market.noMatches')}</p>
      )}

      <div className="pcard-grid">
        {visible.map((listing) => {
          const name = pickLocalized(listing.displayName, i18n.language);
          const affordable = wallet >= listing.price;
          return (
            <PartCard
              key={listing.listingId}
              part={{ ...listing }}
              price={listing.price}
              priceCaption={t('market.youPay')}
              used={listing.kind === 'used'}
              compare={compareContextFor(listing)}
              actions={
                <button
                  type="button"
                  className="btn primary"
                  disabled={!affordable}
                  onClick={() => {
                    setNotice(null);
                    setConfirm({ name, price: listing.price, listingId: listing.listingId });
                  }}
                >
                  {affordable
                    ? t('port.buy')
                    : t('port.needMore', { amount: money(listing.price - wallet) })}
                </button>
              }
            />
          );
        })}
      </div>

      <Popup
        open={confirm !== null}
        title={
          confirm === null ? '' : t('port.buyConfirm', { name: confirm.name, price: confirm.price })
        }
        onClose={() => setConfirm(null)}
      >
        {confirm !== null && (
          <div className="stack">
            <p>{t('port.balanceAfter', { balance: money(wallet - confirm.price) })}</p>
            {confirm.hint !== undefined && <p className="sub">{confirm.hint}</p>}
            {insufficient && <p className="error-text">{t('port.insufficient')}</p>}
            <button
              type="button"
              className="btn primary"
              disabled={buy.isPending || insufficient}
              onClick={() =>
                buy.mutate({ listingId: confirm.listingId, expectedPrice: confirm.price })
              }
            >
              {insufficient ? t('port.notEnoughFunds') : t('port.buy')}
            </button>
          </div>
        )}
      </Popup>
    </section>
  );
}
