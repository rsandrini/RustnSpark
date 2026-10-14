import { useState } from 'react';
import type { ReactNode } from 'react';
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

const BIG_BRIDGE = 2;

type Action = 'expand' | 'shrink';

interface Options {
  /** Everything the pilot owns; the bridges are picked out of it. */
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
 *
 * The controls live inside the bridge's own card in the Upgrade tab: `actionsFor` gives the block
 * for one card and `dialog` is the confirmation, rendered once by the page.
 */
export function useBridgeResize({ parts, wallet, money, onChanged }: Options): {
  isBridge: (item: InventoryItem) => boolean;
  actionsFor: (item: InventoryItem) => ReactNode;
  dialog: ReactNode;
} {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const key = useIntentKey();
  const [confirm, setConfirm] = useState<{ item: InventoryItem; action: Action } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isBridge = (item: InventoryItem) => item.catalog.partClass === 'BRIDGE';
  const bridges = parts.filter(isBridge);
  const actionOf = (item: InventoryItem): Action =>
    item.catalog.w >= BIG_BRIDGE && item.catalog.h >= BIG_BRIDGE ? 'shrink' : 'expand';

  const quotes = useQuery({
    queryKey: ['bridgeResizeQuotes', bridges.map((item) => `${item.id}:${item.partType}`)],
    enabled: bridges.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        bridges.map((item) =>
          client.post<BridgeResizeQuoteResponse>(`/v1/parts/${item.id}/${actionOf(item)}/quote`),
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

  const targetNameOf = (quote: BridgeResizeQuoteResponse | undefined): string =>
    quote?.targetDisplayName === undefined
      ? ''
      : pickLocalized(quote.targetDisplayName, i18n.language);

  // What the (i) next to the button explains: what it becomes, what it costs, and why not.
  const [info, setInfo] = useState<InventoryItem | null>(null);

  const actionsFor = (item: InventoryItem): ReactNode => {
    if (!isBridge(item)) return null;
    const action = actionOf(item);
    const quote = quotes.data?.get(item.id);
    const net = (quote?.cost ?? 0) - (quote?.credit ?? 0);
    const name = pickLocalized(item.displayName, i18n.language);
    return (
      <div className="bridge-resize" data-testid={`bridge-resize-${item.id}`}>
        <button
          type="button"
          className="btn primary"
          disabled={
            quote?.eligible !== true || resize.isPending || (action === 'expand' && net > wallet)
          }
          onClick={() => setConfirm({ item, action })}
        >
          {t(`port.bridgeResize.${action}To`)}
        </button>
        <button
          type="button"
          className="btn info-btn"
          aria-label={`${t('parts.info')}: ${t(`port.bridgeResize.${action}To`)} (${name})`}
          title={t('parts.info')}
          onClick={() => setInfo(item)}
        >
          {t('parts.infoGlyph')}
        </button>
      </div>
    );
  };

  const infoQuote = info === null ? undefined : quotes.data?.get(info.id);
  const infoAction = info === null ? null : actionOf(info);

  const dialog = (
    <>
      {error !== null && <p className="error-text">{error}</p>}
      <Popup
        open={info !== null}
        title={infoAction === null ? '' : t(`port.bridgeResize.${infoAction}To`)}
        onClose={() => setInfo(null)}
      >
        {infoAction !== null && (
          <div className="stack">
            <p>{t(`port.bridgeResize.${infoAction}Help`)}</p>
            <p>
              {infoQuote === undefined
                ? t('loading')
                : infoQuote.eligible
                  ? t(`port.bridgeResize.${infoAction}Row`, {
                      target: targetNameOf(infoQuote),
                      cost: money(infoQuote.cost ?? 0),
                      credit: money(infoQuote.credit ?? 0),
                    })
                  : t(`port.bridgeResize.reason.${infoQuote.reason ?? 'NO_TARGET'}`)}
            </p>
          </div>
        )}
      </Popup>
      <Popup
        open={confirm !== null}
        title={confirm === null ? '' : t(`port.bridgeResize.${confirm.action}ConfirmTitle`)}
        onClose={() => setConfirm(null)}
      >
        {confirm !== null && (
          <div className="stack">
            <p>
              {t(`port.bridgeResize.${confirm.action}ConfirmBody`, {
                name: pickLocalized(confirm.item.displayName, i18n.language),
                target: targetNameOf(quotes.data?.get(confirm.item.id)),
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
    </>
  );

  return { isBridge, actionsFor, dialog };
}
