import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { PartCatalogStats } from '../../api/generated';
import { renderWithProviders } from '../../test/utils';
import { facingOf } from './hangar.geometry';
import { blockTextLayout, fitKindLabel, PartBlockArt } from './part-block-art';

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

  describe('the type row inside the cell (layout B)', () => {
    const part = (partType: string, partClass: string, w: number, h: number) =>
      ({ partType, partClass, w, h }) as unknown as PartCatalogStats;
    const engine2x1 = part('engine_common', 'ENGINE', 2, 1);

    it('a 2x1 engine shows the Engine row with an icon, but icon only (it is 1 cell tall)', () => {
      const { container, getByTestId } = art({ catalog: engine2x1, rot: 0 });
      expect(getByTestId('block-kind')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="block-kind-icon"] svg')).not.toBeNull();
      expect(container.querySelector('[data-testid="block-kind-label"]')).toBeNull();
      expect(container.querySelector('title')?.textContent).toContain('Engine');
    });

    it('a 1x1 part shows only the icon and keeps one name line', () => {
      const { container } = art({ lines: ['Plasma', 'Cannon'] });
      expect(container.querySelector('[data-testid="block-kind-icon"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="block-kind-label"]')).toBeNull();
      expect(container.querySelectorAll('text.block-label tspan')).toHaveLength(1);
      expect(container.querySelector('title')?.textContent).toContain('Weapon');
    });

    it('a 2x2 part shows icon and label, above the name', () => {
      const { container } = art({ catalog: part('tank_common', 'TANK', 2, 2), rot: 0 });
      const label = container.querySelector('[data-testid="block-kind-label"]');
      expect(label?.textContent).toBe('Tank');
      const labelY = Number(label?.getAttribute('y'));
      const nameY = Number(container.querySelector('text.block-label tspan')?.getAttribute('y'));
      expect(labelY).toBeLessThan(nameY);
    });

    it('a rotated footprint uses the rotated height (1x2 at 90 degrees is 2 wide, 1 tall)', () => {
      const tall = part('tank_common', 'TANK', 1, 2);
      const upright = art({ catalog: tall, rot: 0 });
      expect(upright.container.querySelector('[data-testid="block-kind-label"]')).not.toBeNull();
      upright.unmount();
      const sideways = art({ catalog: tall, rot: 90 });
      expect(sideways.container.querySelector('[data-testid="block-kind-label"]')).toBeNull();
      expect(sideways.container.querySelector('[data-testid="block-kind-icon"]')).not.toBeNull();
    });

    it('the row starts at the top of the footprint (gy + 0.2), shifted with the part', () => {
      const { getByTestId } = art({ catalog: engine2x1, rot: 0, gx: 3, gy: 5 });
      const icon = getByTestId('block-kind-icon');
      expect(Number(icon.getAttribute('x'))).toBeCloseTo(3.16);
      expect(Number(icon.getAttribute('y'))).toBeGreaterThanOrEqual(5.2);
    });

    it('the bridge and a ghost show no row', () => {
      const bridge = art({ catalog: part('bridge_common', 'BRIDGE', 1, 1) });
      expect(bridge.container.querySelector('[data-testid="block-kind"]')).toBeNull();
      bridge.unmount();
      const ghost = art({ flags: { ghosting: true } });
      expect(ghost.container.querySelector('[data-testid="block-kind"]')).toBeNull();
      expect(ghost.container.querySelectorAll('text.block-label tspan')).toHaveLength(1);
    });

    it('a long label is shortened to the block width with an ellipsis', () => {
      expect(fitKindLabel('Suporte de vida', 5, 0.17)).toBe('Suporte de vida');
      const cut = fitKindLabel('Suporte de vida', 0.6, 0.17);
      expect(cut.endsWith('…')).toBe(true);
      expect(cut.length * 0.17 * 0.56).toBeLessThanOrEqual(0.6 + 0.17);
    });

    it.each([
      ['1x1', 1, 2],
      ['1x2', 2, 3],
      ['2x1', 1, 2],
      ['2x2', 2, 3],
      ['3x1', 1, 1],
    ])('%s: the row never overlaps the name lines', (_n, height, wantedLines) => {
      for (const font of [0.14, 0.2, 0.28]) {
        const layout = blockTextLayout(10, height, font, wantedLines, true);
        if (layout.row === null) continue;
        const firstTop = layout.firstY - (font * 1.15) / 2;
        expect(layout.row.top + layout.row.height).toBeLessThanOrEqual(firstTop);
        const lastBottom = layout.firstY + (layout.lineCount - 0.5) * font * 1.15;
        expect(lastBottom).toBeLessThanOrEqual(10 + height - 0.24);
        expect(layout.row.showLabel).toBe(height >= 2);
        if (height < 2) expect(layout.lineCount).toBe(1);
      }
      expect(blockTextLayout(10, height, 0.2, wantedLines, true).row).not.toBeNull();
    });

    it('with no row the name keeps its classic place', () => {
      const layout = blockTextLayout(0, 2, 0.2, 2, false);
      expect(layout.row).toBeNull();
      expect(layout.firstY).toBeCloseTo(1 - 0.1 - 0.115);
      expect(layout.lineCount).toBe(2);
    });
  });
});
