import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

const HOVER_MARGIN = 8;
const HOVER_OFFSET = 16;

/**
 * Keeps a hover card fully on screen (owner report, round 6: "its showing after the screen
 * size, I cannot see it completely"). Anchored to the cursor position, then clamped/flipped
 * against the actual viewport using the card's own measured size — content height varies (the
 * compare query is still loading, or has more/fewer rows once it resolves), so a fixed guess
 * can't work; a ResizeObserver re-clamps whenever that measured size changes, not just once on
 * mount. jsdom has no ResizeObserver, so this degrades to a single synchronous placement in
 * tests — the layout tests aren't remeasuring after a resize, only that the card renders.
 *
 * Shared by the Hangar tray's row (`TrayPartRow`) and Market/Store's card (`PartCard`) — same
 * cursor-anchored, viewport-clamped hover card in both places.
 */
export interface HoverAnchor {
  x: number;
  y: number;
  /** Horizontal extent of the list the hovered row lives in: the card opens beside it, never over
      it (owner report: the card sat on the very items being scrolled). */
  avoid?: { left: number; right: number };
}

/** The anchor for a pointer event on `row`: the cursor, plus the nearest scrolling ancestor (the
    part list) as the area the card must stay out of. */
export function hoverAnchor(
  event: { clientX: number; clientY: number },
  row: HTMLElement,
): HoverAnchor {
  let list: HTMLElement | null = row.parentElement;
  while (list !== null) {
    const overflowY = window.getComputedStyle(list).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') break;
    list = list.parentElement;
  }
  const rect = (list ?? row).getBoundingClientRect();
  return { x: event.clientX, y: event.clientY, avoid: { left: rect.left, right: rect.right } };
}

export function useClampedPosition(
  anchor: HoverAnchor | null,
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
      if (anchor.avoid !== undefined) {
        // Beside the list: to its right when there is room, else to its left; only a list that
        // fills the screen (phone) falls back to the cursor placement below.
        const right = anchor.avoid.right + HOVER_OFFSET;
        const leftSide = anchor.avoid.left - HOVER_OFFSET - width;
        if (right + width <= viewportWidth - HOVER_MARGIN) left = right;
        else if (leftSide >= HOVER_MARGIN) left = leftSide;
      } else if (left + width > viewportWidth - HOVER_MARGIN) {
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
