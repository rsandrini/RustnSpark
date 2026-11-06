import { createPortal } from 'react-dom';

/**
 * The part being carried, from the moment it is picked up: the part's own shape (its footprint at the yard's
 * zoom), its rarity colour and its name, centred on the pointer and drawn above everything. It sits on the page
 * body, not inside a panel: a scrolling list or a layer of its own can clip a fixed element or cover it.
 * Decoration only: the real drop is decided by the yard.
 */
export function CarriedPart({
  name,
  rarity,
  width,
  height,
  x,
  y,
}: {
  name: string;
  rarity: string;
  width: number;
  height: number;
  x: number;
  y: number;
}) {
  return createPortal(
    <div
      className={`carried-part rarity-${rarity.toLowerCase()}`}
      aria-hidden="true"
      style={{ left: x, top: y, width, height }}
    >
      <span className="carried-part-name">{name}</span>
    </div>,
    document.body,
  );
}
