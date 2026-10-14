import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { client } from '../../api/client';
import { errorText } from '../../api/errors';
import { useIntentKey } from '../../api/intent-key';
import type {
  BridgeResizeQuoteResponse,
  BridgeResizeResponse,
  InventoryItem,
} from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import { Popup } from '../../ui/Popup';

const SMALL_BRIDGE = 1;
const BIG_BRIDGE = 2;

type Action = 'expand' | 'shrink';

interface Props {
  /** Everything the pilot owns; the panel picks the bridges out of it. */
  parts: readonly InventoryItem[];
  wallet: number;
  money: (value: number) => string;
  /** Called after a successful change so the page refreshes wallet, inventory and ships. */
  onChanged: (message: string) => void;
}

/**
 * Expand / Shrink for the pilot's bridges (docs/TODO.md, bridges 2x2): a 1x1 expands into the 2x2
 * one rarity level below, a 2x2 shrinks back into the 1x1 of the same rarity. Eligibility, price
 * and the refund are the server's (the quote); this only asks and confirms. The new bridge lands
 * in the inventory and the ship has none until it is installed, so the hangar asks for a format.
 */
export function BridgeResizePanel({ parts, wallet, money, onChanged }: Props) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const key = useIntentKey();
  const [confirm, setConfirm] = useState<{ item: InventoryItem; action: Action } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bridges = parts.filter((part) => part.catalog.partClass === 'BRIDGE');
  const actionOf = (item: InventoryItem): Action =>
    item.catalog.w >= BIG_BRIDGE && item.catalog.h >= BIG_BRIDGE ? 'shrink' : 'expand';

  const quotes = useQuery({
    queryKey: ['bridgeResizeQuotes', bridges.map((item) => `${item.id}:${item.partType}`)],
    enabled: bridges.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        bridges.map((item) =>
          client.post<BridgeResizeQuoteResponse>(
            `/v1/parts/${item.id}/${
              item.catalog.w > SMALL_BRIDGE || item.catalog.h > SMALL_BRIDGE ? 'shrink' : 'expand'
            }/quote`,
          ),
        ),
      );
      return new Map(entries.map((quote) => [quote.partInstanceId, quote]));
    },
  });

  const resize = useMutation({
    mutationFn: (args: { partInstanceId: string; action: Action }) =>
      client.post<BridgeResizeResponse>(
        `/v1/parts/${args.partInstanceId}/${args.action}`,
        {},
        { idempotencyKey: key.keyFor(`${args.action}:${args.partInstanceId}`) },
      ),
    onSuccess: (response) => {
      key.clear();
      setConfirm(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['bridgeResizeQuotes'] });
      void queryClient.invalidateQueries({ queryKey: ['upgradeQuotes'] });
      onChanged(
        t(`port.bridgeResize.${response.action}Done`, {
          name: pickLocalized(response.displayName, i18n.language),
        }),
      );
    },
    onError: (failure) => {
      setConfirm(null);
      setError(errorText(t, failure, t('port.failed')));
    },
  });

  if (bridges.length === 0) return null;

  const quoteOf = (item: InventoryItem) => quotes.data?.get(item.id);
  const nameOf = (item: InventoryItem) => pickLocalized(item.displayName, i18n.language);

  return (
    <section className="stack" data-testid="bridge-resize">
      <h3>{t('port.bridgeResize.title')}</h3>
      <p className="sub">{t('port.bridgeResize.help')}</p>
      {error !== null && <p className="error-text">{error}</p>}
      <ul className="stack">
        {bridges.map((item) => {
          const action = actionOf(item);
          const quote = quoteOf(item);
          const target =
            quote?.targetDisplayName !== undefined
              ? pickLocalized(quote.targetDisplayName, i18n.language)
              : '';
          const net = (quote?.cost ?? 0) - (quote?.credit ?? 0);
          return (
            <li key={item.id} className="row" data-testid={`bridge-resize-${item.id}`}>
              <span>
                {quote?.eligible === true
                  ? t(`port.bridgeResize.${action}Row`, {
                      name: nameOf(item),
                      target,
                      cost: money(quote.cost ?? 0),
                      credit: money(quote.credit ?? 0),
                    })
                  : t('port.bridgeResize.blockedRow', {
                      name: nameOf(item),
                      reason:
                        quote === undefined
                          ? t('loading')
                          : t(`port.bridgeResize.reason.${quote.reason ?? 'NO_TARGET'}`),
                    })}
              </span>
              <button
                type="button"
                className="btn primary"
                disabled={
                  quote?.eligible !== true ||
                  resize.isPending ||
                  (action === 'expand' && net > wallet)
                }
                onClick={() => setConfirm({ item, action })}
              >
                {t(`port.bridgeResize.${action}`)}
              </button>
            </li>
          );
        })}
      </ul>

      <Popup
        open={confirm !== null}
        title={confirm === null ? '' : t(`port.bridgeResize.${confirm.action}ConfirmTitle`)}
        onClose={() => setConfirm(null)}
      >
        {confirm !== null && (
          <div className="stack">
            <p>
              {t(`port.bridgeResize.${confirm.action}ConfirmBody`, {
                name: nameOf(confirm.item),
                target:
                  quoteOf(confirm.item)?.targetDisplayName !== undefined
                    ? pickLocalized(quoteOf(confirm.item)!.targetDisplayName!, i18n.language)
                    : '',
              })}
            </p>
            <p className="sub">{t('port.bridgeResize.noBridgeWarning')}</p>
            <button
              type="button"
              className="btn primary"
              disabled={resize.isPending}
              onClick={() =>
                resize.mutate({ partInstanceId: confirm.item.id, action: confirm.action })
              }
            >
              {t('port.bridgeResize.confirm')}
            </button>
          </div>
        )}
      </Popup>
    </section>
  );
}
