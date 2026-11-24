import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '../../../test/utils';
import { RangeLayer } from './range-layer';

const places = [
  { id: 'a', x: 0, y: 0 },
  { id: 'b', x: 50, y: 0 },
  { id: 'c', x: 100, y: 0 },
];

function renderLayer(reachable: Map<string, number>, unlimited = false) {
  return renderWithProviders(
    <svg>
      <RangeLayer places={places} reachable={reachable} unlimited={unlimited} scale={1} />
    </svg>,
    { withRouter: false },
  );
}

describe('RangeLayer', () => {
  it('marks reachable and out-of-range places differently, with text', () => {
    const { container } = renderLayer(
      new Map([
        ['a', 0],
        ['b', 10],
      ]),
    );
    const mark = (id: string) => container.querySelector(`[data-place="${id}"]`)!;
    expect(mark('a')).toHaveAttribute('data-reach', 'yes');
    expect(mark('b')).toHaveAttribute('data-reach', 'yes');
    expect(mark('c')).toHaveAttribute('data-reach', 'no');
    expect(mark('b')).toHaveAttribute('aria-label', 'Reachable with the fuel on board');
    expect(mark('c')).toHaveAttribute('aria-label', 'Out of range with the fuel on board');
    expect(container.querySelectorAll('circle.range-halo')).toHaveLength(2);
    expect(container.querySelectorAll('path.range-cross')).toHaveLength(1);
  });

  it('unlimited reaches every place', () => {
    const { container } = renderLayer(new Map(), true);
    expect(container.querySelectorAll('[data-reach="yes"]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-reach="no"]')).toHaveLength(0);
  });
});
