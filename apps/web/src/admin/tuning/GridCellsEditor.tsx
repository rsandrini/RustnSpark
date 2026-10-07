import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const CANVAS_HALF_SIZE = 15;

export interface GridCellsEditorProps {
  value: [number, number][] | undefined;
  onChange: (cells: [number, number][]) => void;
  /** Soft budget from the entity's cellTarget field — drawn/target shown under the grid,
      extras highlighted in red. Not enforced on save. */
  target?: number;
}

type Cell = [number, number];

interface Gesture {
  seedX: number;
  seedY: number;
  seedPainted: boolean;
  cx: number;
  cy: number;
  moved: boolean;
}

interface SelectionRect {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const keyOf = (x: number, y: number): string => `${x},${y}`;
const isAnchor = (x: number, y: number): boolean => x === 0 && y === 0;

// Inclusive Bresenham line — exact for rows/columns, single-cell diagonal otherwise.
function lineCells(x0: number, y0: number, x1: number, y1: number): Cell[] {
  const out: Cell[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

function rectCells(rect: SelectionRect): Cell[] {
  const x0 = Math.min(rect.ax, rect.bx);
  const x1 = Math.max(rect.ax, rect.bx);
  const y0 = Math.min(rect.ay, rect.by);
  const y1 = Math.max(rect.ay, rect.by);
  const out: Cell[] = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      out.push([x, y]);
    }
  }
  return out;
}

// Rebuild the cell list: force `changes` to paint/erase/invert. The anchor is always kept,
// existing order is preserved, and newly painted cells are appended.
function rebuildCells(
  current: Cell[],
  changes: Cell[],
  mode: 'paint' | 'erase' | 'invert',
): Cell[] {
  const set = new Set(current.map(([x, y]) => keyOf(x, y)));
  for (const [x, y] of changes) {
    if (isAnchor(x, y)) continue;
    const k = keyOf(x, y);
    if (mode === 'paint') set.add(k);
    else if (mode === 'erase') set.delete(k);
    else if (set.has(k)) set.delete(k);
    else set.add(k);
  }
  set.add(keyOf(0, 0));
  const out: Cell[] = [[0, 0]];
  set.delete(keyOf(0, 0));
  for (const [x, y] of current) {
    const k = keyOf(x, y);
    if (k === keyOf(0, 0)) continue;
    if (set.has(k)) {
      out.push([x, y]);
      set.delete(k);
    }
  }
  for (const k of set) {
    const [xs, ys] = k.split(',');
    out.push([Number(xs), Number(ys)]);
  }
  return out;
}

function cellFromEvent(event: React.PointerEvent): Cell | null {
  const target = event.target as HTMLElement | null;
  const fromTarget = target?.closest?.('[data-x]') as HTMLElement | null;
  const fromPoint = (document.elementFromPoint?.(event.clientX, event.clientY) as
    | HTMLElement
    | null)?.closest('[data-x]') as HTMLElement | null;
  const el = fromTarget ?? fromPoint;
  if (!el) return null;
  return [Number(el.dataset.x), Number(el.dataset.y)];
}

// A paint grid for authoring a Ship Format's cell set (2026-10-02-ship-format-design.md):
// click toggles a cell; drag paints/erases a run (row, column or diagonal) whose operation is
// set by the seed cell's state (painted seed → erase run, empty seed → paint run); Shift+click
// two cells selects a rectangle the toolbar can add/remove/invert. The bridge's anchor cell
// (0,0) is always painted and cannot be erased.
export function GridCellsEditor({ value, onChange, target }: GridCellsEditorProps) {
  const { t } = useTranslation();
  const cells = value ?? [[0, 0]];
  const painted = new Set(cells.map(([x, y]) => keyOf(x, y)));
  const drawnCount = cells.length;
  // Cells are an unordered set — "which cells are extra" has no meaning, so the overflow
  // signal is the count line (and a red ring on the wrap), not per-cell highlighting.
  const overBudget = target !== undefined && drawnCount > target;
  const gridRef = useRef<HTMLDivElement>(null);
  const emittedAnchorRef = useRef(false);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [selectionStart, setSelectionStart] = useState<Cell | null>(null);
  const [selection, setSelection] = useState<SelectionRect | null>(null);

  // Create-mode footgun: the form drops undefined fields from the payload, so a brand-new
  // ship-format saved without touching the grid used to omit the required `cells` (server 400).
  useEffect(() => {
    if (value == null && !emittedAnchorRef.current) {
      emittedAnchorRef.current = true;
      onChange([[0, 0]]);
    }
  }, [value, onChange]);

  const previewKeys = new Set<string>();
  if (gesture) {
    for (const [x, y] of lineCells(gesture.seedX, gesture.seedY, gesture.cx, gesture.cy)) {
      if (!isAnchor(x, y)) previewKeys.add(keyOf(x, y));
    }
  }
  const previewErase = gesture?.seedPainted ?? false;

  const selectionKeys = new Set<string>();
  if (selection) {
    for (const [x, y] of rectCells(selection)) selectionKeys.add(keyOf(x, y));
  }

  const toggle = (x: number, y: number) => {
    if (isAnchor(x, y)) return;
    onChange(rebuildCells(cells, [[x, y]], 'invert'));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const cell = cellFromEvent(event);
    if (!cell) return;
    const [x, y] = cell;
    if (event.shiftKey) {
      event.preventDefault();
      if (!selectionStart) {
        setSelectionStart([x, y]);
        setSelection(null);
      } else {
        setSelection({ ax: selectionStart[0], ay: selectionStart[1], bx: x, by: y });
        setSelectionStart(null);
      }
      return;
    }
    if (isAnchor(x, y)) return;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* jsdom or unsupported: bubbled events still track the gesture */
    }
    setGesture({
      seedX: x,
      seedY: y,
      seedPainted: painted.has(keyOf(x, y)),
      cx: x,
      cy: y,
      moved: false,
    });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!gesture) return;
    const cell = cellFromEvent(event);
    if (!cell) return;
    const [x, y] = cell;
    if (!gesture.moved && x === gesture.seedX && y === gesture.seedY) return;
    setGesture({ ...gesture, cx: x, cy: y, moved: true });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!gesture) return;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }
    const g = gesture;
    setGesture(null);
    if (!g.moved) {
      toggle(g.seedX, g.seedY);
      return;
    }
    const line = lineCells(g.seedX, g.seedY, g.cx, g.cy);
    onChange(rebuildCells(cells, line, g.seedPainted ? 'erase' : 'paint'));
  };

  const applyToSelection = (mode: 'paint' | 'erase' | 'invert') => {
    if (!selection) return;
    onChange(rebuildCells(cells, rectCells(selection), mode));
    setSelection(null);
    setSelectionStart(null);
  };

  const clearSelection = () => {
    setSelection(null);
    setSelectionStart(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    setGesture(null);
    clearSelection();
  };

  const coords: number[] = [];
  for (let i = -CANVAS_HALF_SIZE; i <= CANVAS_HALF_SIZE; i += 1) coords.push(i);

  return (
    <div
      className={`grid-cells-editor-wrap${overBudget ? ' over-target' : ''}`}
      onKeyDown={handleKeyDown}
    >
      <div
        className="grid-cells-editor"
        role="group"
        aria-label={t('tuning.gridCells.group')}
        ref={gridRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {coords.map((y) => (
          <div key={y} className="grid-cells-row">
            {coords.map((x) => {
              const anchor = isAnchor(x, y);
              const isPainted = painted.has(keyOf(x, y));
              const k = keyOf(x, y);
              const inPreview = previewKeys.has(k);
              const inSelection = selectionKeys.has(k);
              const classes = [
                'grid-cells-cell',
                isPainted ? 'painted' : '',
                anchor ? 'anchor' : '',
                inPreview ? (previewErase ? 'preview-erase' : 'preview-paint') : '',
                inSelection ? 'selected' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <button
                  key={x}
                  type="button"
                  data-testid={`grid-cell-${x}-${y}`}
                  data-x={x}
                  data-y={y}
                  className={classes}
                  aria-pressed={isPainted}
                  aria-disabled={anchor}
                  onClick={(event) => {
                    // Pointer gestures are handled by the pointerup path (real mouse clicks
                    // carry detail >= 1). detail === 0 means a keyboard activation (or a
                    // synthetic fireEvent.click in tests) — toggle there.
                    if (event.detail !== 0 || event.shiftKey) return;
                    toggle(x, y);
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div
        className={`grid-cells-count${overBudget ? ' over' : ''}`}
        data-testid="grid-cells-count"
        role="status"
      >
        {target === undefined
          ? String(drawnCount)
          : overBudget
            ? `${drawnCount} / ${target} (+${drawnCount - target})`
            : `${drawnCount} / ${target}`}
      </div>
      {selection && (
        <div
          className="grid-cells-toolbar"
          role="group"
          aria-label={t('tuning.gridCells.selection')}
        >
          <button type="button" className="chip" onClick={() => applyToSelection('paint')}>
            {t('tuning.gridCells.add')}
          </button>
          <button type="button" className="chip" onClick={() => applyToSelection('erase')}>
            {t('tuning.gridCells.remove')}
          </button>
          <button type="button" className="chip" onClick={() => applyToSelection('invert')}>
            {t('tuning.gridCells.invert')}
          </button>
          <button type="button" className="chip" onClick={clearSelection}>
            {t('tuning.gridCells.clear')}
          </button>
        </div>
      )}
    </div>
  );
}
