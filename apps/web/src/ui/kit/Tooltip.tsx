import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

export interface TooltipProps {
  content: ReactNode;
  /**
   * The one element the tooltip describes. It must be a focusable DOM element (a button, a link, an element with
   * tabIndex 0) or a component that passes `aria-describedby` and `tabIndex` to its root (Gauge and ResourceChip do),
   * otherwise the link to the card is lost and keyboard users cannot open it.
   */
  children: ReactElement<{ 'aria-describedby'?: string }>;
  /** Which edge of the trigger the card hangs from; use 'end' for a trigger at the right edge of the screen. */
  align?: 'start' | 'end';
  /** False when the trigger already carries the same text as its name: no `aria-describedby`, so it is read once. */
  describe?: boolean;
}

/**
 * A card with the explanation that used to sit on the page as a paragraph. Opens on hover, on keyboard focus and on
 * tap; closes on Escape, on a tap outside, on blur and on mouse leave. The content is `role="tooltip"` and the
 * trigger points at it with `aria-describedby`. Presentational: the text comes in as `content`.
 */
export function Tooltip({ content, children, align = 'start', describe = true }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  // True while the card was opened by hover or focus and the click that finishes the same gesture has not come yet:
  // that click keeps it open, the next one closes it.
  const opener = useRef(false);
  // The pointer type of the last pointer event on the trigger. A touch tap makes some browsers send a `mouseleave` right
  // after the compatibility mouse events; that one must not close the card (a second tap, Escape or a tap outside does).
  const pointer = useRef('');

  const show = () => {
    opener.current = true;
    setOpen(true);
  };
  const leave = () => {
    if (pointer.current === 'touch') return;
    hide();
  };
  const hide = () => {
    opener.current = false;
    setOpen(false);
  };
  const toggle = () => {
    if (opener.current) {
      opener.current = false;
      setOpen(true);
      return;
    }
    setOpen((was) => !was);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    const onOutside = (event: Event) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) hide();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutside);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onOutside);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className="kit-tip"
      onMouseEnter={show}
      onMouseLeave={leave}
      onPointerEnter={(event) => {
        pointer.current = event.pointerType;
      }}
      onPointerDown={(event) => {
        pointer.current = event.pointerType;
      }}
      onFocus={show}
      onBlur={hide}
      onClick={toggle}
    >
      {cloneElement(children, open && describe ? { 'aria-describedby': id } : {})}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={`kit-tip-card${align === 'end' ? ' kit-tip-card--end' : ''}`}
        >
          {content}
        </span>
      )}
    </span>
  );
}
