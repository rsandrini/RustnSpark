import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { PartCatalogStats } from '../../api/generated';
import { renderWithProviders } from '../../test/utils';
import { facingOf } from './hangar.geometry';
import { blockTextLayout, clipNameLines, fitKindLabel, PartBlockArt } from './part-block-art';

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
      catalog: { ...cannon, w: 2, h: 2 },
      rot: 0,
      look: { rarity: 'Common', condition: 10, broken: true },
    });
    const block = container.querySelector('rect.block');
    expect(block).toHaveClass('broken');
    expect(block?.getAttribute('class')).toMatch(/cond-/);
    expect(container.querySelector('text.block-label')?.textContent).toContain('Cannon');
  });

  it('an unknown-family part reads its class word in the type row and the title', () => {
    const { container } = art({
      catalog: { ...cannon, partType: 'mystery_common', partClass: 'UTILITY', w: 2, h: 2 },
    });
    expect(container.querySelector('[data-testid="block-kind-label"]')?.textContent).toBe(
      'Utility',
    );
    expect(container.querySelector('title')?.textContent).toContain('Utility');
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

    it('a 1x1 part with a one-line name shows only the icon; a two-line name keeps both lines and drops the icon', () => {
      const one = art({ lines: ['Plasma'] });
      expect(one.container.querySelector('[data-testid="block-kind-icon"]')).not.toBeNull();
      expect(one.container.querySelector('[data-testid="block-kind-label"]')).toBeNull();
      one.unmount();
      const { container } = art({ lines: ['Plasma', 'Cannon'] });
      expect(container.querySelector('[data-testid="block-kind-icon"]')).toBeNull();
      expect(container.querySelectorAll('text.block-label tspan')).toHaveLength(2);
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
      const layout = blockTextLayout(5, 1, 0.2, 1, true);
      const row = layout.row!;
      expect(Number(icon.getAttribute('y'))).toBeCloseTo(5.2 + (row.height - row.icon) / 2);
    });

    describe('the row is centred in the footprint', () => {
      it.each([
        ['1x1 (icon only)', 1, 1, 0, 'Weapon'],
        ['1x2', 1, 2, 0, 'Tank'],
        ['2x1', 2, 1, 0, 'Engine'],
        ['2x2', 2, 2, 0, 'Tank'],
        ['3x1', 3, 1, 0, 'Engine'],
        ['1x2 rotated 90', 1, 2, 90, 'Tank'],
      ])('%s: the row centre x is the footprint centre x', (_n, w, h, rot, label) => {
        const fw = rot === 90 ? h : w;
        const fh = rot === 90 ? w : h;
        const gx = 4;
        const layout = blockTextLayout(0, fh, 0.2, 1, true, fw, label, gx);
        const row = layout.row!;
        expect(row.x + row.groupWidth / 2).toBeCloseTo(gx + fw / 2, 2);
        if (!row.showLabel) expect(row.groupWidth).toBeCloseTo(row.icon);
        else expect(row.groupWidth).toBeGreaterThan(row.icon);
      });

      it('render: the icon svg is centred on the block (2x1) and the group on the 2x2', () => {
        const wide = art({ catalog: engine2x1, rot: 0, gx: 3 });
        const icon = wide.getByTestId('block-kind-icon');
        expect(Number(icon.getAttribute('x')) + Number(icon.getAttribute('width')) / 2).toBeCloseTo(
          4,
          2,
        );
        wide.unmount();
        const sq = art({ catalog: part('tank_common', 'TANK', 2, 2), rot: 0, gx: 3 });
        const ic = sq.getByTestId('block-kind-icon');
        const label = sq.getByTestId('block-kind-label');
        const left = Number(ic.getAttribute('x'));
        const labelX = Number(label.getAttribute('x'));
        expect(label.getAttribute('text-anchor')).toBe('start');
        const lay = blockTextLayout(0, 2, 0.2, 1, true, 2, 'Tank', 3).row!;
        const right = labelX + (label.textContent ?? '').length * lay.font * 0.56;
        expect((left + right) / 2).toBeCloseTo(4, 1);
      });
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
      expect(cut.length * 0.17 * 0.56).toBeLessThanOrEqual(0.6);
    });

    it.each([
      ['1x1', 1, 2],
      ['1x2', 2, 3],
      ['2x1', 1, 2],
      ['2x2', 2, 3],
      ['3x1', 1, 1],
      ['1x2 at rot 90 (the 2x1 footprint)', 1, 2],
    ])('%s: the row never overlaps the name lines', (_n, height, wantedLines) => {
      for (const font of [0.14, 0.16, 0.2, 0.28, 0.42]) {
        const layout = blockTextLayout(10, height, font, wantedLines, true);
        expect(layout.lineCount).toBeGreaterThanOrEqual(1);
        const lh = layout.nameFont * 1.15;
        const lastBottom = layout.firstY + (layout.lineCount - 0.5) * lh;
        // Only when the name can fit at all between the dots (0.2) and the bar (0.24).
        if (font <= 0.16 || layout.lineCount * lh <= height - 0.44) {
          expect(lastBottom).toBeLessThanOrEqual(10 + height - 0.24 + 1e-9);
        }
        if (layout.row) {
          const row = layout.row;
          expect(row.top + row.height).toBeLessThanOrEqual(layout.firstY - lh / 2 + 1e-9);
          expect(row.showLabel).toBe(height >= 2);
        }
      }
    });

    it('drops the type row, not the name, when a short block cannot hold both (guest ship evidence)', () => {
      const one = blockTextLayout(0, 1, 0.16, 3, true, 1, 'Cargo');
      expect(one.row).toBeNull();
      expect(one.lineCount).toBe(3);
      const two = blockTextLayout(0, 1, 0.16, 2, true, 2, 'Tank');
      expect(two.lineCount).toBe(2);
      expect(two.row).toBeNull();
      expect(blockTextLayout(0, 1, 0.16, 1, true, 1, 'Weapon').row).not.toBeNull();
      const tall = blockTextLayout(0, 2, 0.16, 3, true, 1, 'Cargo');
      expect(tall.row).not.toBeNull();
      expect(tall.lineCount).toBe(3);
    });

    it('keeps the name text inside the block whenever the row is dropped', () => {
      const l = blockTextLayout(0, 1, 0.16, 3, true, 1, 'Cargo');
      const lh = l.nameFont * 1.15;
      expect(l.firstY - lh / 2).toBeGreaterThanOrEqual(0.2 - 1e-9);
      expect(l.firstY + (l.lineCount - 0.5) * lh).toBeLessThanOrEqual(1 - 0.24 + 1e-9);
    });

    it('a 4-line name on a 1x1 is capped and ends with an ellipsis, above the bar', () => {
      const l = blockTextLayout(0, 1, 0.16, 4, true, 1, 'Cargo');
      expect(l.lineCount).toBe(3);
      const lh = l.nameFont * 1.15;
      expect(l.firstY + (l.lineCount - 0.5) * lh).toBeLessThanOrEqual(1 - 0.24 + 1e-9);
      const { container } = art({
        lines: ['Núcleo', 'de Energia', 'Auxiliar', 'Pesado'],
        labelFont: 0.16,
      });
      const spans = container.querySelectorAll('text.block-label tspan');
      expect(spans).toHaveLength(3);
      expect(spans[2]?.textContent?.endsWith('…')).toBe(true);
    });

    it('clipNameLines ends a cut name with an ellipsis', () => {
      expect(clipNameLines(['Motor', 'Químico', 'Aprimorado'], 3)).toEqual([
        'Motor',
        'Químico',
        'Aprimorado',
      ]);
      expect(clipNameLines(['Motor', 'Químico', 'Aprimorado'], 1)).toEqual(['Motor…']);
      expect(clipNameLines(['Comparti…', 'de Carga'], 1)).toEqual(['Comparti…']);
    });

    it('draws every wrapped line of a 1x1 part', () => {
      const { container } = art({ lines: ['Motor', 'Químico', 'Aprimorado'], labelFont: 0.16 });
      expect(container.querySelectorAll('text.block-label tspan')).toHaveLength(3);
      expect(container.querySelector('[data-testid="block-kind-icon"]')).toBeNull();
    });

    it('a 1x1 at a large label font keeps the icon and shrinks the name instead of overlapping it', () => {
      const layout = blockTextLayout(0, 1, 0.42, 1, true);
      expect(layout.row).not.toBeNull();
      expect(layout.nameFont).toBeLessThan(0.42);
      expect(layout.row!.top + layout.row!.height).toBeLessThanOrEqual(
        layout.firstY - (layout.nameFont * 1.15) / 2 + 1e-9,
      );
      const { container } = art({ labelFont: 0.42 });
      const icon = container.querySelector('[data-testid="block-kind-icon"]')!;
      const tspan = container.querySelector('text.block-label tspan')!;
      const fontSize = parseFloat(
        (container.querySelector('text.block-label') as SVGElement).style.fontSize,
      );
      const nameTop = Number(tspan.getAttribute('y')) - fontSize * 0.35 - (fontSize * 1.15) / 2;
      expect(
        Number(icon.getAttribute('y')) + Number(icon.getAttribute('height')),
      ).toBeLessThanOrEqual(nameTop + 1e-9);
    });

    it('drops the row only when even a squeezed name cannot clear it', () => {
      expect(blockTextLayout(0, 0.6, 0.2, 1, true).row).toBeNull();
    });

    it.each([
      ['2x1', 'engine_common', 'ENGINE', 2, 1, 0],
      ['2x2', 'tank_common', 'TANK', 2, 2, 0],
      ['1x2 at rot 90', 'tank_common', 'TANK', 1, 2, 90],
    ])('%s: in the render the icon ends above the first name line', (_n, type, cls, w, h, rot) => {
      const { container } = art({
        catalog: part(type, cls, w, h),
        rot: rot as 0 | 90,
        gy: 4,
        lines: ['Name'],
      });
      const icon = container.querySelector('[data-testid="block-kind-icon"]')!;
      const fontSize = parseFloat(
        (container.querySelector('text.block-label') as SVGElement).style.fontSize,
      );
      const tspan = container.querySelector('text.block-label tspan')!;
      const nameTop = Number(tspan.getAttribute('y')) - fontSize * 0.35 - (fontSize * 1.15) / 2;
      expect(
        Number(icon.getAttribute('y')) + Number(icon.getAttribute('height')),
      ).toBeLessThanOrEqual(nameTop + 1e-9);
    });

    it('a broken 1x1 shows its name and its Broken text (the icon gives way)', () => {
      const { container } = art({
        look: { rarity: 'Rare', condition: 0, broken: true },
        lines: ['Cannon'],
      });
      const text = container.querySelector('text.block-label')?.textContent ?? '';
      expect(text).toContain('BROKEN');
      expect(text).toContain('Cannon');
    });

    it('with no row the name keeps its classic place', () => {
      const layout = blockTextLayout(0, 2, 0.2, 2, false);
      expect(layout.row).toBeNull();
      expect(layout.firstY).toBeCloseTo(1 - 0.1 - 0.115);
      expect(layout.lineCount).toBe(2);
    });
  });
});
