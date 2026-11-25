import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Placement } from '../../api/generated';
import { ShipMiniMap } from './ShipMiniMap';

const layout: Placement[] = [
  { partInstanceId: 'a', gx: 0, gy: 0, rot: 0 },
  { partInstanceId: 'b', gx: 1, gy: 0, rot: 90 },
  { partInstanceId: 'c', gx: 3, gy: 2, rot: 0, outside: true },
];
const sizes: Record<string, { width: number; height: number }> = {
  a: { width: 1, height: 1 },
  b: { width: 2, height: 1 },
  c: { width: 1, height: 1 },
};
const footprintOf = (id: string) => sizes[id];

function setReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe('ShipMiniMap', () => {
  it('is an image with the label and one rect per placed part', () => {
    render(<ShipMiniMap layout={layout} footprintOf={footprintOf} label="Part to upgrade: X" />);
    expect(screen.getByRole('img', { name: 'Part to upgrade: X' })).toBeInTheDocument();
    expect(document.querySelectorAll('rect')).toHaveLength(3);
  });

  it('highlights the part with the given id, and only that one', () => {
    render(<ShipMiniMap layout={layout} footprintOf={footprintOf} highlightId="b" label="x" />);
    const hot = document.querySelectorAll('.kit-shipmap-hot');
    expect(hot).toHaveLength(1);
    expect(hot[0]).toHaveAttribute('data-part-id', 'b');
  });

  it('highlights nothing for an unknown id', () => {
    render(<ShipMiniMap layout={layout} footprintOf={footprintOf} highlightId="zz" label="x" />);
    expect(document.querySelector('.kit-shipmap-hot')).toBeNull();
  });

  it('fades the parts outside the hull', () => {
    render(<ShipMiniMap layout={layout} footprintOf={footprintOf} label="x" />);
    const faded = document.querySelectorAll('.kit-shipmap-out');
    expect(faded).toHaveLength(1);
    expect(faded[0]).toHaveAttribute('data-part-id', 'c');
  });

  it('draws the footprint it is given (a 1x2 turned 90 degrees is 2 wide, 1 tall)', () => {
    const turned: Placement[] = [{ partInstanceId: 'r', gx: 0, gy: 0, rot: 90 }];
    render(<ShipMiniMap layout={turned} footprintOf={() => ({ width: 2, height: 1 })} label="x" />);
    const rect = document.querySelector('rect')!;
    expect(Number(rect.getAttribute('width'))).toBeGreaterThan(Number(rect.getAttribute('height')));
  });

  it('skips a part the caller has no footprint for', () => {
    render(
      <ShipMiniMap
        layout={layout}
        footprintOf={(id) => (id === 'a' ? sizes.a : undefined)}
        label="x"
      />,
    );
    expect(document.querySelectorAll('rect')).toHaveLength(1);
  });

  it('renders an empty layout as an empty chart', () => {
    render(<ShipMiniMap layout={[]} footprintOf={footprintOf} label="x" />);
    expect(screen.getByRole('img', { name: 'x' })).toBeInTheDocument();
    expect(document.querySelectorAll('rect')).toHaveLength(0);
  });

  it('pulses the highlight, unless the player prefers reduced motion', () => {
    setReducedMotion(false);
    const { unmount } = render(
      <ShipMiniMap layout={layout} footprintOf={footprintOf} highlightId="a" label="x" />,
    );
    expect(document.querySelector('.kit-shipmap-pulse')).not.toBeNull();
    unmount();
    setReducedMotion(true);
    render(<ShipMiniMap layout={layout} footprintOf={footprintOf} highlightId="a" label="x" />);
    expect(document.querySelector('.kit-shipmap-pulse')).toBeNull();
    expect(document.querySelector('.kit-shipmap-hot')).not.toBeNull();
  });
});
