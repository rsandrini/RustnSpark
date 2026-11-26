import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { MaterialsResponse } from '../../api/generated';
import { pickLocalized } from '../../i18n/localized';
import type { GoodsGroup } from './goods-groups';

type Holding = MaterialsResponse['materials'][number];

interface MaterialGroupProps {
  group: GoodsGroup;
  holdings: readonly Holding[];
  money: (value: number) => string;
  sellAmountOf: (materialId: string, held: number) => number;
  onAmount: (materialId: string, amount: number) => void;
  onSell: (holding: Holding, amount: number) => void;
}

/** One section of the goods screen: a title with what the group is worth, then a row per material. */
export function MaterialGroup({
  group,
  holdings,
  money,
  sellAmountOf,
  onAmount,
  onSell,
}: MaterialGroupProps): ReactNode {
  const { t, i18n } = useTranslation();
  const worth = holdings.reduce((sum, holding) => sum + holding.unitPrice * holding.quantity, 0);
  return (
    <section className="goods-group" data-testid={`goods-${group}`}>
      <header className="goods-group-head">
        <h3 className="port-subhead">{t(`port.goods.${group}`)}</h3>
        <span className="goods-group-worth">{t('port.goods.worth', { value: money(worth) })}</span>
      </header>
      {holdings.map((holding) => {
        const name = pickLocalized(holding.displayName, i18n.language);
        const amount = sellAmountOf(holding.materialId, holding.quantity);
        return (
          <article key={holding.materialId} className="goods-row">
            <div className="goods-row-info">
              <h4 className="goods-row-name">
                {[t('port.quantity', { quantity: holding.quantity }), name].join(' ')}
              </h4>
              <p className="sub goods-row-desc">
                {pickLocalized(holding.description, i18n.language)}
              </p>
              <small className="goods-row-unit">
                {t('port.unitPrice', { price: holding.unitPrice })}
              </small>
            </div>
            <div className="goods-row-sell">
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
                    onChange={(event) => onAmount(holding.materialId, Number(event.target.value))}
                  />
                  <b>{amount}</b>
                </label>
              )}
              <button type="button" className="btn primary" onClick={() => onSell(holding, amount)}>
                {amount === holding.quantity
                  ? t('port.sellAll')
                  : t('port.sellSome', { count: amount })}
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
