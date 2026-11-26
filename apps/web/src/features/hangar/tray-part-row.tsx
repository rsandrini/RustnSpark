import { useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { InventoryItem } from '../../api/generated';
import { Gauge, conditionTone } from '../../ui/Gauge';
import { PartThumb } from '../../ui/PartThumb';
import {
  PartStatsCard,
  RarityBadge,
  useNumberFormat,
  type PartCompareContext,
} from '../parts/part-detail';
import { fitView } from '../parts/fit-view';
import type { PortFit } from '../parts/port-fit';
import { ConnectorGrid } from '../parts/connector-grid';
import { PartInfoButton } from '../parts/part-info-button';
import { PartKindTag, MetaLine } from '../parts/part-kind-tag';
import {
  hoverAnchor,
  useClampedPosition,
  type HoverAnchor,
} from '../parts/use-hover-card-position';

export interface TrayPartRowProps {
  part: InventoryItem;
  /** The part has just landed in the list: it grows into place. */
  arrived?: boolean;
  name: string;
  disabled: boolean;
  selected: boolean;
  onSelect: () => void;
  /** Pointer down on the row: the page starts a drag out of the list once the pointer has moved far enough. */
  onPointerDragStart?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  compare: PartCompareContext | undefined;
  /** Whether the part's ports join a free port of the ship; absent where there is no ship to compare to. */
  fit?: PortFit;
}

// One tray row: its own button, the (i) popup, and (owner request, round 5/6) a hover card
// showing the same comparison, positioned beside the cursor and clamped to stay fully visible.
const NO_FIT_MARK = '✕';

export function TrayPartRow({
  part,
  name,
  disabled,
  selected,
  arrived = false,
  onSelect,
  onPointerDragStart,
  compare,
  fit,
}: TrayPartRowProps) {
  const { t } = useTranslation();
  const format = useNumberFormat();
  const [anchor, setAnchor] = useState<HoverAnchor | null>(null);
  const { ref: cardRef, style: cardStyle } = useClampedPosition(anchor);

  const view = fitView(fit);
  const chip =
    view === undefined
      ? undefined
      : {
          tone: view.tone,
          text: t('connectors.fit.chipNone'),
          sentence: t(`connectors.fit.${view.key}`, view.counts),
        };

  return (
    <div
      className={`part-btn-wrap${arrived ? ' arrived' : ''}`}
      data-tour={part.catalog.partClass === 'ENGINE' ? 'part_engine' : undefined}
    >
      <button
        type="button"
        className={`part-btn rarity-${part.rarity.toLowerCase()}${part.broken ? ' broken' : ''}${selected ? ' on' : ''}`}
        disabled={disabled}
        onClick={onSelect}
        onPointerDown={(event) => {
          if (!disabled) onPointerDragStart?.(event);
        }}
        onPointerEnter={(event) => setAnchor(hoverAnchor(event, event.currentTarget))}
        onPointerLeave={() => setAnchor(null)}
      >
        <span className="part-line">
          <PartThumb name={name} rarity={part.rarity} />
          {name}
          <RarityBadge rarity={part.rarity} />
        </span>
        <span className="meta">
          <MetaLine
            pieces={[
              <PartKindTag key="kind" catalog={part.catalog} />,
              `${part.catalog.w}×${part.catalog.h}`,
            ]}
          />
        </span>
        {(part.storedFuel ?? 0) > 0 && (
          <span className="meta" data-testid="stored-fuel">
            {t('hangar.storedFuel', { value: format(Math.round(part.storedFuel ?? 0)) })}
          </span>
        )}
        {chip !== undefined && (
          <span
            className={`tray-fit ${chip.tone}`}
            data-testid="tray-fit"
            role="img"
            aria-label={chip.sentence}
            title={chip.sentence}
          >
            <span aria-hidden="true">
              {NO_FIT_MARK} {chip.text}
            </span>
          </span>
        )}
        {part.connectors.length > 0 && (
          <ConnectorGrid
            w={part.catalog.w}
            h={part.catalog.h}
            connectors={part.connectors}
            size="mini"
          />
        )}
        <Gauge
          value={Math.round(part.condition)}
          max={100}
          tone={conditionTone(part.condition)}
          ariaLabel={t('port.conditionNow', { value: Math.round(part.condition) })}
          label={t('port.conditionNow', { value: Math.round(part.condition) })}
        />
      </button>
      <PartInfoButton part={part} compare={compare} />
      {anchor !== null && (
        <div ref={cardRef} className="compare-hover-card" aria-hidden="true" style={cardStyle}>
          <PartStatsCard part={part} compare={compare} />
        </div>
      )}
    </div>
  );
}
