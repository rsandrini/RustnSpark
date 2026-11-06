import { createPortal } from 'react-dom';
import { PartThumb } from '../../ui/PartThumb';

/**
 * A part being carried, drawn like a row of the parts list (the rarity colour on its edge, its tile and its
 * name) and following the pointer, above everything. Decoration only: the real drop is decided by the yard.
 */
export function TrayDragChip({
  name,
  rarity,
  x,
  y,
}: {
  name: string;
  rarity: string;
  x: number;
  y: number;
}) {
  // On the page body, not where the caller sits: inside the scrolling parts list a fixed chip can be clipped or
  // end up under a neighbour's layer, and it must stay above everything.
  return createPortal(
    <div
      className={`tray-drag-chip part-btn rarity-${rarity.toLowerCase()}`}
      aria-hidden="true"
      style={{ left: x, top: y }}
    >
      <span className="part-line">
        <PartThumb name={name} rarity={rarity} />
        {name}
      </span>
    </div>,
    document.body,
  );
}
