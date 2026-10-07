import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GridCellsPreview } from './GridCellsPreview';

describe('GridCellsPreview', () => {
  it('renders one rect per cell and an anchor distinct from painted cells', () => {
    render(<GridCellsPreview cells={[[0, 0], [1, 0], [2, 0]]} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('aria-label')).toBe('Ship format preview (3 cells)');
    const rects = img.querySelectorAll('rect');
    expect(rects).toHaveLength(3);
    expect(img.querySelector('.grid-preview-anchor')).not.toBeNull();
    expect(img.querySelectorAll('.grid-preview-cell')).toHaveLength(2);
  });

  it('keeps negative coordinates inside the viewBox', () => {
    render(<GridCellsPreview cells={[[0, 0], [-1, 2]]} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('viewBox')).toBe('-1.2 -0.2 2.4 3.4');
  });

  it('falls back to raw JSON when cells is not a valid pair list', () => {
    render(<GridCellsPreview cells={['nope', 42]} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('["nope",42]')).toBeInTheDocument();
  });

  it('renders nothing for empty or missing cells', () => {
    const { container: empty } = render(<GridCellsPreview cells={[]} />);
    expect(empty).toBeEmptyDOMElement();
    const { container: missing } = render(<GridCellsPreview cells={undefined} />);
    expect(missing).toBeEmptyDOMElement();
  });
});
