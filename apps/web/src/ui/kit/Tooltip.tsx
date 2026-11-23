import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

export interface TooltipProps {
  content: ReactNode;
  /** The one element the tooltip describes (a button, a link, an icon wrapper with tabIndex 0). */
  children: ReactElement<{ 'aria-describedby'?: string }>;
}

/**
 * A card with the explanation that used to sit on the page as a paragraph. Opens on hover, on keyboard focus and on
 * tap; closes on Escape, on a tap outside, on blur and on mouse leave. The content is `role="tooltip"` and the
 * trigger points at it with `aria-describedby`. Presentational: the text comes in as `content`.
 */
export function Tooltip({ content, children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onOutside = (event: Event) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
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
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={() => setOpen(true)}
    >
      {cloneElement(children, open ? { 'aria-describedby': id } : {})}
      {open && (
        <span role="tooltip" id={id} className="kit-tip-card">
          {content}
        </span>
      )}
    </span>
  );
}
