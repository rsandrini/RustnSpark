import { createPortal } from 'react-dom';
import type { PartCatalogStats } from '../../api/generated';
import type { PortMark } from './connectors';
import { PartBlockArt } from './part-block-art';
import type { Rot } from './hangar.geometry';
import type { PartLook } from './ship-yard';

export interface CarriedPartProps {
  catalog: PartCatalogStats;
  name: string;
  look: PartLook | undefined;
  colorBy: 'rarity' | 'condition';
  rot: Rot;
  /** The part's footprint in cells, and how many screen pixels one cell is at the yard's zoom. */
  widthCells: number;
  heightCells: number;
  cellPx: number;
  /** The same wrapped name and font the parts on the ship use. */
  lines: readonly string[];
  labelFont: number;
  portMarks: readonly PortMark[];
  /** Where the pointer is. */
  x: number;
  y: number;
}

/**
 * The part being carried, drawn with the very same art as a part on the ship (its rarity border, name, condition
 * bar, facing arrow and connector ports), at the size it will have there, centred on the pointer and above every
 * panel. It sits on the page body: inside a scrolling panel a fixed element can be clipped or covered. Decoration
 * only: the real drop is decided by the yard.
 */
export function CarriedPart({
  catalog,
  name,
  look,
  colorBy,
  rot,
  widthCells,
  heightCells,
  cellPx,
  lines,
  labelFont,
  portMarks,
  x,
  y,
}: CarriedPartProps) {
  return createPortal(
    <div
      className="carried-part"
      aria-hidden="true"
      style={{ left: x, top: y, width: widthCells * cellPx, height: heightCells * cellPx }}
    >
      <svg
        viewBox={`0 0 ${widthCells} ${heightCells}`}
        width="100%"
        height="100%"
        overflow="visible"
      >
        <PartBlockArt
          gx={0}
          gy={0}
          rot={rot}
          catalog={catalog}
          name={name}
          look={look}
          colorBy={colorBy}
          portMarks={portMarks}
          lines={lines}
          labelFont={labelFont}
        />
      </svg>
    </div>,
    document.body,
  );
}
