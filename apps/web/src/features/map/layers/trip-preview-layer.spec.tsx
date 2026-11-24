import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderWithProviders } from '../../../test/utils';
import { TripPreviewLayer } from './trip-preview-layer';

const places = new Map([
  ['a', { x: 0, y: 0 }],
  ['b', { x: 50, y: 10 }],
  ['c', { x: 100, y: 0 }],
]);
const legs = [
  { fromId: 'a', toId: 'b' },
  { fromId: 'b', toId: 'c' },
];

function render(l: typeof legs | undefined) {
  return renderWithProviders(
    <svg>
      <TripPreviewLayer legs={l} places={places} />
    </svg>,
    { withRouter: false },
  );
}

describe('TripPreviewLayer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('draws one polyline through the legs', () => {
    const { container } = render(legs);
    const lines = container.querySelectorAll('polyline');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveAttribute('points', '0,0 50,10 100,0');
    expect(lines[0]).toHaveClass('trip-preview-anim');
  });

  it('draws nothing without a quote', () => {
    expect(render(undefined).container.querySelector('polyline')).toBeNull();
    expect(render([]).container.querySelector('polyline')).toBeNull();
  });

  it('drops the animation under reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { container } = render(legs);
    expect(container.querySelector('polyline')).not.toHaveClass('trip-preview-anim');
  });
});
