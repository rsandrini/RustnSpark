import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { PartCatalogStats } from '../../api/generated';
import { renderWithProviders } from '../../test/utils';
import { facingOf } from './hangar.geometry';
import { PartBlockArt } from './part-block-art';

const cannon = {
  partType: 'cannon',
  partClass: 'WEAPON',
  w: 1,
  h: 1,
} as unknown as PartCatalogStats;

function art(props: Partial<Parameters<typeof PartBlockArt>[0]> = {}) {
  return renderWithProviders(
    <svg>
      <PartBlockArt
        gx={0}
        gy={0}
        rot={90}
        catalog={cannon}
        name="Cannon"
        look={{ rarity: 'Rare', condition: 80, broken: false }}
        colorBy="rarity"
        portMarks={[
          { partInstanceId: 'p', x: 0, y: 0, side: 'N', kind: 'central', state: 'available' },
        ]}
        lines={['Cannon']}
        labelFont={0.2}
        {...props}
      />
    </svg>,
    { withRouter: false },
  );
}

describe('PartBlockArt (the one drawing of a part, in the ship and while carried)', () => {
  it('draws the block in its rarity colour, with its name, its condition bar and its ports', () => {
    const { container } = art();
    const block = container.querySelector('rect.block');
    expect(block).toHaveClass('rar-rare');
    expect(container.querySelector('text.block-label')?.textContent).toBe('Cannon');
    expect(container.querySelector('rect.cond-bar')).not.toBeNull();
    expect(container.querySelector('.cond-label')?.textContent).toBe('80%');
    expect(container.querySelectorAll('[data-testid="port-mark"]')).toHaveLength(1);
  });

  it('a weapon or an engine shows its facing arrow, turned with the part', () => {
    const { container } = art({ rot: 90 });
    expect(container.querySelector('polygon.facing-arrow')).toHaveAttribute(
      'data-facing',
      facingOf(90),
    );
  });

  it('colours by condition when asked, and marks a broken part', () => {
    const { container } = art({
      colorBy: 'condition',
      look: { rarity: 'Common', condition: 10, broken: true },
    });
    const block = container.querySelector('rect.block');
    expect(block).toHaveClass('broken');
    expect(block?.getAttribute('class')).toMatch(/cond-/);
    expect(container.querySelector('text.block-label')?.textContent).toContain('Cannon');
  });

  it('passes the interactive props to the block rect (the yard hangs its drag handlers there)', () => {
    let pressed = false;
    const { container } = art({
      rectProps: { 'data-part-id': 'p', onPointerDown: () => (pressed = true) },
    });
    const block = container.querySelector('rect.block') as SVGRectElement;
    expect(block.getAttribute('data-part-id')).toBe('p');
    block.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(pressed).toBe(true);
    render(<span />);
  });
});
