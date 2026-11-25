import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { pickLocalized } from '../../i18n/localized';
import { PartKindTag, MetaLine } from './part-kind-tag';
import { Gauge, conditionTone } from '../../ui/Gauge';
import { PartArt } from './part-art';
import { partKindOf } from './part-kind';
import {
  PartDetail,
  PartStatsCard,
  type PartCompareContext,
  type PartInfoData,
} from './part-detail';
import { ConnectorGrid } from './connector-grid';
import { fitView } from './fit-view';
import type { PortFit } from './port-fit';
import { PartInfoButton } from './part-info-button';
import { hoverAnchor, useClampedPosition, type HoverAnchor } from './use-hover-card-position';

export interface PartCardProps {
  part: PartInfoData;
  /** The number the card leads with (buy price, or what the port pays). */
  price?: number;
  /** Small text under the price ("You pay", "Port pays"). */
  priceCaption?: string;
  /** A short warning under the meta line ("too damaged to sell"). */
  note?: string;
  /** A used listing: tagged so it is never mistaken for a new part. */
  used?: boolean;
  /** Buttons on the card's footer; the details button is always added. */
  actions?: ReactNode;
  /** Market/Store only: what buying this would do to the ship, shown in its detail popup. */
  compare?: PartCompareContext;
  /** Extra content for the card's single info popup, under the part's own details. */
  infoExtra?: ReactNode;
  /** Hide the (i) details button (the Upgrade tab shows the diff on hover instead). */
  hideInfo?: boolean;
  /** What the hover card shows when it is not the card's own part (the Upgrade tab hovers the
      part it WILL become). Everywhere else the hover card shows the card's part. */
  hoverPart?: PartInfoData;
  /** When set, the hover card renders the "this part today → upgraded" table instead of the
      usual stats card. */
  hoverVersus?: PartInfoData;
  /** Store cards: how the part's ports match the free ports of the ship. */
  fit?: PortFit;
}

// One part, one card, stacked top to bottom: name and price, what it is, how worn it is, what it
// does, then the buttons. The rarity is the accent colour of the card.
export function PartCard({
  part,
  price,
  priceCaption,
  note,
  used = false,
  actions,
  compare,
  infoExtra,
  hideInfo = false,
  hoverPart,
  hoverVersus,
  fit,
}: PartCardProps) {
  const { t, i18n } = useTranslation();
  const name = pickLocalized(part.displayName, i18n.language);
  const money = (value: number) => `${new Intl.NumberFormat(i18n.language).format(value)} ¢`;
  const condition = part.condition === undefined ? undefined : Math.round(part.condition);
  const meta = (
    <MetaLine
      pieces={[
        <PartKindTag key="kind" catalog={part.catalog} />,
        t(`parts.rarities.${part.rarity}`, { defaultValue: part.rarity }),
        `${part.catalog.w}×${part.catalog.h}`,
      ]}
    />
  );

  const verdict = fitView(fit);

  // Owner request: Market/Store gets the same hover-only compare card the Hangar tray already
  // has, not just the (i) button's full popup — cursor-anchored, viewport-clamped the same way.
  const [anchor, setAnchor] = useState<HoverAnchor | null>(null);
  const { ref: cardRef, style: cardStyle } = useClampedPosition(anchor);

  return (
    <article
      className={`pcard rarity-${part.rarity.toLowerCase()}${part.broken === true ? ' broken' : ''}`}
      onPointerEnter={(event) => setAnchor(hoverAnchor(event, event.currentTarget))}
      onPointerLeave={() => setAnchor(null)}
    >
      <header className="pcard-head">
        <div className="pcard-title-row">
          <PartArt catalog={part.catalog} rarity={part.rarity} size={72} />
          <h2 className="pcard-name">{name}</h2>
        </div>
        {price !== undefined && (
          <div className="pcard-price">
            <b>{money(price)}</b>
            {priceCaption !== undefined && <small>{priceCaption}</small>}
          </div>
        )}
      </header>
      <div className="pcard-meta">
        {used && <span className="used-tag">{t('market.used')}</span>}
        {meta}
      </div>
      {part.connectors !== undefined && part.connectors.length > 0 && (
        <div className="pcard-ports">
          <ConnectorGrid
            w={part.catalog.w}
            h={part.catalog.h}
            connectors={part.connectors}
            size="large"
            kind={partKindOf(part.catalog)}
          />
          {verdict !== undefined && (
            <p className={`pcard-fit ${verdict.tone}`} data-testid="part-fit">
              <span aria-hidden="true">{verdict.icon}</span>{' '}
              {t(`connectors.fit.${verdict.key}`, verdict.counts)}
            </p>
          )}
        </div>
      )}
      {(part.broken === true || note !== undefined) && (
        <div className="pcard-note">{part.broken === true ? t('parts.broken') : note}</div>
      )}
      {condition !== undefined && condition < 100 && (
        <Gauge
          value={condition}
          max={100}
          tone={conditionTone(condition)}
          ariaLabel={`${name}: ${t('port.conditionNow', { value: condition })}`}
          label={t('port.conditionNow', { value: condition })}
        />
      )}
      <footer className="pcard-actions">
        {!hideInfo && <PartInfoButton part={part} compare={compare} extra={infoExtra} />}
        {actions}
      </footer>
      {anchor !== null && (
        <div
          ref={cardRef}
          className="compare-hover-card"
          aria-hidden="true"
          data-testid="part-card-hover-card"
          style={cardStyle}
        >
          {hoverVersus !== undefined ? (
            <PartDetail part={hoverPart ?? part} versus={hoverVersus} hideMeta />
          ) : (
            <PartStatsCard
              part={hoverPart ?? part}
              compare={hoverPart === undefined ? compare : undefined}
            />
          )}
        </div>
      )}
    </article>
  );
}
