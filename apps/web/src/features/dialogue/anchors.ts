import { useEffect, useState } from 'react';

export interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** How often the page is looked at again while a popup points at something (layout moves, tabs switch). */
const WATCH_MS = 400;

/**
 * Where the screen element named by a `data-tour` attribute is right now, or null when it is not on the screen (the
 * popup then simply stays where its node puts it). It follows scrolling, resizing and layout changes.
 */
export function useAnchorRect(anchor: string | null): AnchorRect | null {
  const [rect, setRect] = useState<AnchorRect | null>(null);

  useEffect(() => {
    if (anchor === null) {
      setRect(null);
      return undefined;
    }
    const read = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
      if (el === null) {
        setRect((was) => (was === null ? was : null));
        return;
      }
      const box = el.getBoundingClientRect();
      const visible = box.width > 0 && box.height > 0;
      const next = visible
        ? { top: box.top, left: box.left, width: box.width, height: box.height }
        : null;
      setRect((was) =>
        was?.top === next?.top &&
        was?.left === next?.left &&
        was?.width === next?.width &&
        was?.height === next?.height
          ? was
          : next,
      );
    };
    read();
    const timer = window.setInterval(read, WATCH_MS);
    window.addEventListener('resize', read);
    window.addEventListener('scroll', read, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('resize', read);
      window.removeEventListener('scroll', read, true);
    };
  }, [anchor]);

  return rect;
}
