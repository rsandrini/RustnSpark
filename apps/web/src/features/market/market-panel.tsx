import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import { errorCodeOf, errorText, priceChangedActualOf } from '../../api/errors';
import { useIntentKey } from '../../api/intent-key';
import type { BuyResponse, MarketListing, MarketResponse } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { ItemCard } from '../../ui/ItemCard';
import { Popup } from '../../ui/Popup';
import { useAuthContext } from '../auth/auth.context';
import { partSummary, useNumberFormat } from '../parts/part-detail';
import { PartInfoButton } from '../parts/part-info-button';

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
}

// The buy side of a port: a filterable list of offers with the full explanation of each part
// one click away, and the confirm-then-buy flow. Used by the Port's market tab and by the
// Hangar's Store tab, so both behave (and read) the same.
export function MarketPanel({
  locationId,
  presetClass = null,
  onNotice,
  showBalance = false,
}: MarketPanelProps) {
  const { t, i18n } = useTranslation();
  const { user, reloadProfile } = useAuthContext();
  const queryClient = useQueryClient();
  const buyKey = useIntentKey();
  const format = useNumberFormat();
  const [confirm, setConfirm] = useState<ConfirmBuy | null>(null);
  const [ownNotice, setOwnNotice] = useState<string | null>(null);
  const notice = onNotice === undefined ? ownNotice : null;
  const setNotice = onNotice ?? setOwnNotice;
  const [actionError, setActionError] = useState<string | null>(null);
  const [partClass, setPartClass] = useState<string | null>(presetClass);
  const [search, setSearch] = useState('');
  const [condition, setCondition] = useState<Condition>('all');
  const [sort, setSort] = useState<SortKey>('name');

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

  const listings = useMemo(() => marketQuery.data?.listings ?? [], [marketQuery.data]);
  const classes = useMemo(
    () => Array.from(new Set(listings.map((listing) => listing.catalog.partClass))).sort(),
    [listings],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const nameOf = (listing: MarketListing) => pickLocalized(listing.displayName, i18n.language);
    const filtered = listings.filter((listing) => {
      if (partClass !== null && listing.catalog.partClass !== partClass) return false;
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
  }, [listings, partClass, condition, search, sort, i18n.language]);

  const insufficient = confirm !== null && wallet < confirm.price;

  return (
    <section className="stack market-panel">
      <h2>{t('port.forSale')}</h2>
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

      <div className="market-filters" role="search">
        <div className="chips" role="group" aria-label={t('market.filterByType')}>
          <button
            type="button"
            className={`chip${partClass === null ? ' on' : ''}`}
            aria-pressed={partClass === null}
            onClick={() => setPartClass(null)}
          >
            {t('market.all')}
          </button>
          {classes.map((cls) => (
            <button
              key={cls}
              type="button"
              className={`chip${partClass === cls ? ' on' : ''}`}
              aria-pressed={partClass === cls}
              onClick={() => setPartClass(cls)}
            >
              {t(`hangar.partClasses.${cls}`)}
            </button>
          ))}
        </div>
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
            value={condition}
            aria-label={t('market.condition')}
            onChange={(event) => setCondition(event.target.value as Condition)}
          >
            <option value="all">{t('market.conditionAll')}</option>
            <option value="new">{t('market.conditionNew')}</option>
            <option value="used">{t('market.conditionUsed')}</option>
          </select>
          <select
            className="input"
            value={sort}
            aria-label={t('market.sort')}
            onChange={(event) => setSort(event.target.value as SortKey)}
          >
            <option value="name">{t('market.sortName')}</option>
            <option value="priceAsc">{t('market.sortPriceAsc')}</option>
            <option value="priceDesc">{t('market.sortPriceDesc')}</option>
            <option value="condition">{t('market.sortCondition')}</option>
          </select>
        </div>
      </div>

      {listings.length === 0 && marketQuery.isSuccess && (
        <p className="sub">{t('port.marketEmpty')}</p>
      )}
      {listings.length > 0 && visible.length === 0 && (
        <p className="sub">{t('market.noMatches')}</p>
      )}

      <div className="grid-cards">
        {visible.map((listing) => {
          const name = pickLocalized(listing.displayName, i18n.language);
          const affordable = wallet >= listing.price;
          return (
            <ItemCard
              key={listing.listingId}
              name={name}
              description={
                <>
                  <span className="part-summary">{partSummary(listing.catalog, t, format)}</span>
                  <span className="part-desc-short">
                    {pickLocalized(listing.description, i18n.language)}
                  </span>
                  <span className="part-price">
                    {listing.kind === 'used' && (
                      <span className="used-tag">{t('market.used')}</span>
                    )}
                    {[
                      t(`hangar.partClasses.${listing.catalog.partClass}`),
                      `${listing.condition}%`,
                      money(listing.price),
                    ].join(' · ')}
                  </span>
                </>
              }
              action={
                <span className="row-between">
                  <PartInfoButton part={listing} />
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!affordable}
                    onClick={() => {
                      setNotice(null);
                      setConfirm({ name, price: listing.price, listingId: listing.listingId });
                    }}
                  >
                    {t('port.buy')}
                  </button>
                </span>
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
              {t('port.buy')}
            </button>
          </div>
        )}
      </Popup>
    </section>
  );
}
