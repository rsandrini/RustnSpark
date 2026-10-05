import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GridCellsEditor } from './GridCellsEditor';

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
});
