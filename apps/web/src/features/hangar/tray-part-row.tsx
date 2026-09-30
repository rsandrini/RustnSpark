import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { InventoryItem } from '../../api/generated';
import { Gauge, conditionTone } from '../../ui/Gauge';
import { PartThumb } from '../../ui/PartThumb';
import {
  PartStatsCard,
  RarityBadge,
  partSummary,
  useNumberFormat,
  type PartCompareContext,
} from '../parts/part-detail';
import { PartInfoButton } from '../parts/part-info-button';

const HOVER_MARGIN = 8;
const HOVER_OFFSET = 16;

/**
 * Keeps the hover card fully on screen (owner report, round 6: "its showing after the screen
 * size, I cannot see it completely"). Anchored to the cursor position, then clamped/flipped
 * against the actual viewport using the card's own measured size — content height varies (the
 * compare query is still loading, or has more/fewer rows once it resolves), so a fixed guess
 * can't work; a ResizeObserver re-clamps whenever that measured size changes, not just once on
 * mount. jsdom has no ResizeObserver, so this degrades to a single synchronous placement in
 * tests — the layout tests aren't remeasuring after a resize, only that the card renders.
 */
function useClampedPosition(
  anchor: { x: number; y: number } | null,
): { ref: React.RefObject<HTMLDivElement>; style: CSSProperties } {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    // jsdom's synthetic PointerEvent doesn't reliably carry clientX/clientY through
    // fireEvent(); a real browser always does (verified live). Treat a not-yet-known anchor
    // the same as no anchor, rather than letting NaN leak into the style.
    if (
      anchor === null ||
      el === null ||
      !Number.isFinite(anchor.x) ||
      !Number.isFinite(anchor.y)
    ) {
      setPos(null);
      return undefined;
    }
    const reposition = () => {
      const { width, height } = el.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      // jsdom (tests) never does real layout — getBoundingClientRect() is always zero there, and
      // clamping against a zero-size box would just reproduce the raw anchor position anyway (or
      // divide-by-zero into NaN if the viewport dimensions are themselves unreliable). Skip the
      // math entirely rather than risk a NaN style in a non-layout environment.
      if (
        (width === 0 && height === 0) ||
        !Number.isFinite(viewportWidth) ||
        !Number.isFinite(viewportHeight)
      ) {
        setPos({ left: anchor.x + HOVER_OFFSET, top: anchor.y });
        return;
      }
      let left = anchor.x + HOVER_OFFSET;
      if (left + width > viewportWidth - HOVER_MARGIN) {
        left = anchor.x - HOVER_OFFSET - width;
      }
      left = Math.max(HOVER_MARGIN, Math.min(left, viewportWidth - width - HOVER_MARGIN));
      let top = anchor.y;
      if (top + height > viewportHeight - HOVER_MARGIN) {
        top = viewportHeight - height - HOVER_MARGIN;
      }
      top = Math.max(HOVER_MARGIN, top);
      setPos({ left, top });
    };
    reposition();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(reposition);
    observer.observe(el);
    return () => observer.disconnect();
  }, [anchor]);

  // Invisible until the first real measurement lands, so it never flashes at the raw
  // cursor-relative guess before being clamped into view.
  const style: CSSProperties =
    pos === null
      ? { left: anchor?.x ?? 0, top: anchor?.y ?? 0, visibility: 'hidden' }
      : { left: pos.left, top: pos.top };
  return { ref, style };
}

export interface TrayPartRowProps {
  part: InventoryItem;
  name: string;
  disabled: boolean;
  selected: boolean;
  onSelect: () => void;
  compare: PartCompareContext | undefined;
}

// One tray row: its own button, the (i) popup, and (owner request, round 5/6) a hover card
// showing the same comparison, positioned beside the cursor and clamped to stay fully visible.
export function TrayPartRow({ part, name, disabled, selected, onSelect, compare }: TrayPartRowProps) {
  const { t } = useTranslation();
  const format = useNumberFormat();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const { ref: cardRef, style: cardStyle } = useClampedPosition(anchor);

  return (
    <div className="part-btn-wrap">
      <button
        type="button"
        className={`part-btn rarity-${part.rarity.toLowerCase()}${part.broken ? ' broken' : ''}${selected ? ' on' : ''}`}
        disabled={disabled}
        onClick={onSelect}
        onPointerEnter={(event) => setAnchor({ x: event.clientX, y: event.clientY })}
        onPointerLeave={() => setAnchor(null)}
      >
        <span className="part-line">
          <PartThumb name={name} rarity={part.rarity} />
          {name}
          <RarityBadge rarity={part.rarity} />
        </span>
        <span className="meta">
          {[t(`hangar.partClasses.${part.catalog.partClass}`), `${part.catalog.w}×${part.catalog.h}`].join(
            ' · ',
          )}
        </span>
        <span className="meta">{partSummary(part.catalog, t, format)}</span>
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
        <div ref={cardRef} className="tray-hover-card" aria-hidden="true" style={cardStyle}>
          <PartStatsCard part={part} compare={compare} />
        </div>
      )}
    </div>
  );
}
