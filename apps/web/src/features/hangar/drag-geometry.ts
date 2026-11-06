/** Where an element sits on the screen (what `getBoundingClientRect()` gives). */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The yard's window onto the grid: the centre cell and how many cells wide it shows. */
export interface YardView {
  cx: number;
  cy: number;
  /** Visible width in cells (the yard is square). */
  span: number;
}

/** A press that moves less than this is a click, not a drag. */
export const DRAG_THRESHOLD_PX = 6;

/** A screen position as a position in yard cells (fractional). */
export function clientToCells(
  box: Box,
  view: YardView,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const unit = view.span / Math.max(box.width, 1);
  return {
    x: view.cx - view.span / 2 + (clientX - box.left) * unit,
    y: view.cy - view.span / 2 + (clientY - box.top) * unit,
  };
}

export function insideBox(box: Box, clientX: number, clientY: number): boolean {
  return (
    clientX >= box.left &&
    clientX <= box.left + box.width &&
    clientY >= box.top &&
    clientY <= box.top + box.height
  );
}

export function movedPastThreshold(startX: number, startY: number, x: number, y: number): boolean {
  return Math.hypot(x - startX, y - startY) >= DRAG_THRESHOLD_PX;
}

/**
 * Dragging is for a mouse or a pen on a ship that can be edited. A finger keeps tap-then-tap (the
 * phone's parts list is a scrolling sheet, and a drag there would fight the scroll). jsdom has no
 * pointer type, so an empty one counts as a mouse.
 */
export function startsDrag(pointerType: string, editable: boolean): boolean {
  return editable && pointerType !== 'touch';
}
