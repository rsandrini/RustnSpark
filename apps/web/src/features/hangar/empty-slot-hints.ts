import type { PartKind } from '../parts/part-kind';
import type { ShipNeed } from '../market/ship-needs';
import type { PortMark, Side } from './connectors';

export interface SlotHint {
  needId: string;
  /** The class of part that fixes the need (what the Store opens with). */
  partClass: string;
  x: number;
  y: number;
  side: Side;
}

const OFFSETS: Record<Side, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};

const NEED_KIND: Record<string, PartKind> = {
  weapon: 'weapon',
  defense: 'armor',
  shield: 'shield',
  battery: 'battery',
  power: 'reactor',
  cargo: 'cargo',
};

/** The kind of part (and so the icon) a need asks for. */
export function kindOfNeed(needId: string): PartKind {
  return NEED_KIND[needId] ?? 'other';
}

/**
 * Where a needed part could go: for each need in order, the first free port whose neighbouring cell is
 * empty, inside the ship and not already offered to an earlier need. At most `max` hints.
 */
export function emptySlotHints(input: {
  marks: readonly PortMark[];
  occupied: ReadonlySet<string>;
  inBounds: (x: number, y: number) => boolean;
  needs: readonly ShipNeed[];
  max?: number;
}): SlotHint[] {
  const { marks, occupied, inBounds, needs, max = 3 } = input;
  const hints: SlotHint[] = [];
  const taken = new Set<string>();
  for (const need of needs) {
    if (hints.length >= max) break;
    for (const mark of marks) {
      if (mark.state !== 'available') continue;
      const { dx, dy } = OFFSETS[mark.side];
      const x = mark.x + dx;
      const y = mark.y + dy;
      const key = `${x},${y}`;
      if (occupied.has(key) || taken.has(key) || !inBounds(x, y)) continue;
      taken.add(key);
      hints.push({ needId: need.id, partClass: need.partClass, x, y, side: mark.side });
      break;
    }
  }
  return hints;
}

/** Whether the dashed slots show: only for a docked ship outside the opening with something lacking, and never
    while a part is dragged, carried over the yard or picked from the tray (a tap on a cell places it). */
export function showSlotHints(input: {
  ghost: boolean;
  dropPreview: boolean;
  pendingPartId: string | null;
  needsCount: number;
  docked: boolean;
  opening: boolean;
}): boolean {
  return (
    !input.ghost &&
    !input.dropPreview &&
    input.pendingPartId === null &&
    input.needsCount > 0 &&
    input.docked &&
    !input.opening
  );
}
