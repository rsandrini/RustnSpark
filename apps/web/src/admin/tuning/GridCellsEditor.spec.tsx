import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GridCellsEditor } from './GridCellsEditor';

// jsdom ships no PointerEvent constructor, so fireEvent falls back to Event and silently drops
// init properties like shiftKey (which the Shift+click selection path reads). This polyfill —
// a MouseEvent subclass — restores them; real browsers use their own PointerEvent.
class PointerEventPolyfill extends MouseEvent {}
if (typeof window.PointerEvent !== 'function') {
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

const cell = (x: number, y: number) => screen.getByTestId(`grid-cell-${x}-${y}`);

describe('GridCellsEditor', () => {
  it('always includes [0,0] pre-painted and locked', () => {
    render(<GridCellsEditor value={[[0, 0]]} onChange={vi.fn()} />);
    const origin = screen.getByTestId('grid-cell-0-0');
    expect(origin).toHaveClass('painted');
    fireEvent.click(origin);
    expect(origin).toHaveClass('painted'); // still painted: clicking the anchor does nothing
  });

  it('toggles a non-anchor cell on click and reports the new cell list', () => {
    const onChange = vi.fn();
    render(<GridCellsEditor value={[[0, 0]]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('grid-cell-1-0'));
    expect(onChange).toHaveBeenCalledWith([[0, 0], [1, 0]]);
  });

  it('erases a painted cell on a second click', () => {
    const onChange = vi.fn();
    render(<GridCellsEditor value={[[0, 0], [1, 0]]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('grid-cell-1-0'));
    expect(onChange).toHaveBeenCalledWith([[0, 0]]);
  });

  it('defaults to just the anchor cell when value is empty/undefined', () => {
    render(<GridCellsEditor value={undefined} onChange={vi.fn()} />);
    expect(screen.getByTestId('grid-cell-0-0')).toHaveClass('painted');
  });

  it('emits the anchor on mount when value is undefined (create-mode save footgun)', () => {
    const onChange = vi.fn();
    render(<GridCellsEditor value={undefined} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith([[0, 0]]);
  });

  it('drag-paints a horizontal run from an empty seed', () => {
    const onChange = vi.fn();
    render(<GridCellsEditor value={[[0, 0]]} onChange={onChange} />);
    fireEvent.pointerDown(cell(1, 0));
    fireEvent.pointerMove(cell(3, 0));
    fireEvent.pointerUp(cell(3, 0));
    expect(onChange).toHaveBeenCalledWith([[0, 0], [1, 0], [2, 0], [3, 0]]);
  });

  it('drag-erases a horizontal run from a painted seed', () => {
    const onChange = vi.fn();
    render(<GridCellsEditor value={[[0, 0], [1, 0], [2, 0], [3, 0]]} onChange={onChange} />);
    fireEvent.pointerDown(cell(1, 0));
    fireEvent.pointerMove(cell(3, 0));
    fireEvent.pointerUp(cell(3, 0));
    expect(onChange).toHaveBeenCalledWith([[0, 0]]);
  });

  it('drag-paints a vertical run from an empty seed', () => {
    const onChange = vi.fn();
    render(<GridCellsEditor value={[[0, 0]]} onChange={onChange} />);
    fireEvent.pointerDown(cell(0, 1));
    fireEvent.pointerMove(cell(0, 3));
    fireEvent.pointerUp(cell(0, 3));
    expect(onChange).toHaveBeenCalledWith([[0, 0], [0, 1], [0, 2], [0, 3]]);
  });

  it('never erases the anchor in a drag stroke', () => {
    const onChange = vi.fn();
    render(<GridCellsEditor value={[[0, 0], [0, 1], [1, 0]]} onChange={onChange} />);
    fireEvent.pointerDown(cell(1, 0));
    fireEvent.pointerMove(cell(0, 0));
    fireEvent.pointerUp(cell(0, 0));
    expect(onChange).toHaveBeenCalledWith([[0, 0], [0, 1]]);
  });

  it('shows a paint preview while dragging and applies on pointerup', () => {
    const onChange = vi.fn();
    render(<GridCellsEditor value={[[0, 0]]} onChange={onChange} />);
    fireEvent.pointerDown(cell(1, 0));
    fireEvent.pointerMove(cell(2, 0));
    expect(cell(1, 0)).toHaveClass('preview-paint');
    expect(cell(2, 0)).toHaveClass('preview-paint');
    fireEvent.pointerUp(cell(2, 0));
    expect(cell(1, 0)).not.toHaveClass('preview-paint');
    expect(onChange).toHaveBeenCalledWith([[0, 0], [1, 0], [2, 0]]);
  });

  it('shift+click two cells selects a rectangle and Add paints every selected cell', () => {
    const onChange = vi.fn();
    render(<GridCellsEditor value={[[0, 0]]} onChange={onChange} />);
    fireEvent.pointerDown(cell(1, 0), { shiftKey: true });
    fireEvent.pointerDown(cell(3, 1), { shiftKey: true });
    expect(cell(2, 1)).toHaveClass('selected');
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  });

  it('Remove erases every selected cell but keeps the anchor', () => {
    const onChange = vi.fn();
    render(<GridCellsEditor value={[[0, 0], [1, 0], [2, 0], [3, 0]]} onChange={onChange} />);
    fireEvent.pointerDown(cell(1, 0), { shiftKey: true });
    fireEvent.pointerDown(cell(3, 0), { shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onChange).toHaveBeenCalledWith([[0, 0]]);
  });

  it('Invert toggles each selected cell individually', () => {
    const onChange = vi.fn();
    render(<GridCellsEditor value={[[0, 0], [1, 0], [2, 0]]} onChange={onChange} />);
    fireEvent.pointerDown(cell(1, 0), { shiftKey: true });
    fireEvent.pointerDown(cell(3, 0), { shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Invert' }));
    expect(onChange).toHaveBeenCalledWith([[0, 0], [3, 0]]);
  });

  it('Clear dismisses the selection without emitting', () => {
    const onChange = vi.fn();
    render(<GridCellsEditor value={[[0, 0]]} onChange={onChange} />);
    fireEvent.pointerDown(cell(1, 0), { shiftKey: true });
    fireEvent.pointerDown(cell(2, 0), { shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    expect(cell(1, 0)).not.toHaveClass('selected');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Escape clears an active selection', () => {
    render(<GridCellsEditor value={[[0, 0]]} onChange={vi.fn()} />);
    fireEvent.pointerDown(cell(1, 0), { shiftKey: true });
    fireEvent.pointerDown(cell(2, 0), { shiftKey: true });
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    fireEvent.keyDown(cell(1, 0), { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('shift+click on a cell does not toggle it', () => {
    const onChange = vi.fn();
    render(<GridCellsEditor value={[[0, 0]]} onChange={onChange} />);
    fireEvent.click(cell(1, 0), { shiftKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows drawn/target count under the grid when a target is set', () => {
    render(<GridCellsEditor value={[[0, 0], [1, 0]]} onChange={vi.fn()} target={5} />);
    const count = screen.getByTestId('grid-cells-count');
    expect(count).toHaveTextContent('2 / 5');
    expect(count).not.toHaveClass('over');
    expect(count.closest('.grid-cells-editor-wrap')).not.toHaveClass('over-target');
  });

  it('marks the budget as over (red count) when drawn exceeds target', () => {
    render(<GridCellsEditor value={[[0, 0], [1, 0], [2, 0]]} onChange={vi.fn()} target={2} />);
    const count = screen.getByTestId('grid-cells-count');
    expect(count).toHaveTextContent('3 / 2 (+1)');
    expect(count).toHaveClass('over');
    expect(count.closest('.grid-cells-editor-wrap')).toHaveClass('over-target');
  });

  it('shows a bare count when no target is set', () => {
    render(<GridCellsEditor value={[[0, 0]]} onChange={vi.fn()} />);
    expect(screen.getByTestId('grid-cells-count')).toHaveTextContent('1');
  });
});
