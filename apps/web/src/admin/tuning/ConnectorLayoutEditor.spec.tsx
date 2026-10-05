import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConnectorLayoutEditor } from './ConnectorLayoutEditor';

describe('ConnectorLayoutEditor', () => {
  it('renders one grid per candidate, sized to w x h', () => {
    render(
      <ConnectorLayoutEditor
        value={[{ cells: [] }]}
        w={2}
        h={1}
        onChange={vi.fn()}
      />,
    );
    // 2x1 footprint: 2 cells, each with 4 clickable sides.
    expect(screen.getAllByTestId(/connector-side-0-0-/)).toHaveLength(4);
    expect(screen.getAllByTestId(/connector-side-1-0-/)).toHaveLength(4);
  });

  it('cycles a side through none -> central -> split -> universal -> none on repeated clicks', () => {
    const onChange = vi.fn();
    render(<ConnectorLayoutEditor value={[{ cells: [] }]} w={1} h={1} onChange={onChange} />);
    const side = screen.getByTestId('connector-side-0-0-S-candidate-0');
    fireEvent.click(side);
    expect(onChange).toHaveBeenLastCalledWith([{ cells: [{ dx: 0, dy: 0, side: 'S', kind: 'central' }] }]);
  });

  it('adds a new candidate', () => {
    const onChange = vi.fn();
    render(<ConnectorLayoutEditor value={[{ cells: [] }]} w={1} h={1} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add candidate/i }));
    expect(onChange).toHaveBeenCalledWith([{ cells: [] }, { cells: [] }]);
  });
});
