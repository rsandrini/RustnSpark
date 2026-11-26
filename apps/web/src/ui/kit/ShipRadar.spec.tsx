import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../i18n/en.json';
import ptBR from '../../i18n/pt-BR.json';
import type { ShipProfile } from '../../api/generated';
import { ShipRadar, RADAR_AXES, radarLabelBox } from './ShipRadar';

const LABEL = 'Ship profile';
const FLAT: ShipProfile = {
  cargo: 0.5,
  passengers: 0.5,
  firepower: 0.5,
  defense: 0.5,
  mobility: 0.5,
  range: 0.5,
  mining: 0.5,
};

function vertices(el: Element): [number, number][] {
  return (el.getAttribute('points') ?? '')
    .split(' ')
    .map((p) => p.split(',').map(Number) as [number, number]);
}

function radii(el: Element): number[] {
  return vertices(el).map(([x, y]) => Math.hypot(x - 100, y - 100));
}

function at(list: number[], i: number): number {
  return list[i] ?? Number.NaN;
}

function shape(container: HTMLElement): Element {
  return container.querySelector('.kit-radar-shape') as Element;
}

describe('ShipRadar', () => {
  it('is an image named by the label and draws a 7-vertex polygon', () => {
    const { container } = render(<ShipRadar values={FLAT} label={LABEL} />);
    expect(screen.getByRole('img', { name: LABEL })).toBeInTheDocument();
    expect(vertices(shape(container))).toHaveLength(7);
  });

  it('collapses 0 to the centre and puts 1 on the rim', () => {
    const { container } = render(
      <ShipRadar values={{ ...FLAT, cargo: 0, passengers: 1 }} label={LABEL} />,
    );
    const r = radii(shape(container));
    const rings = container.querySelectorAll('.kit-radar-ring');
    const rim = at(radii(rings[rings.length - 1] as Element), 0);
    expect(at(r, 0)).toBeCloseTo(0, 1);
    expect(at(r, 1)).toBeCloseTo(rim, 1);
    expect(at(r, 1)).toBeGreaterThan(at(r, 2));
  });

  it('starts at the top', () => {
    const { container } = render(<ShipRadar values={{ ...FLAT, cargo: 1 }} label={LABEL} />);
    const [x, y] = vertices(shape(container))[0] ?? [0, 0];
    expect(x).toBeCloseTo(100, 1);
    expect(y).toBeLessThan(100);
  });

  it('places axes in order, clockwise from the top, at value * radius', () => {
    const order = ['cargo', 'passengers', 'firepower', 'defense', 'mobility', 'range', 'mining'];
    const values = Object.fromEntries(order.map((k, i) => [k, i / 10 + 0.1])) as ShipProfile;
    const { container } = render(<ShipRadar values={values} label={LABEL} />);
    const rings = container.querySelectorAll('.kit-radar-ring');
    const rim = at(radii(rings[rings.length - 1] as Element), 0);
    vertices(shape(container)).forEach(([x, y], i) => {
      const expected = -Math.PI / 2 + (i * 2 * Math.PI) / 7;
      const angle = Math.atan2(y - 100, x - 100);
      const diff = Math.atan2(Math.sin(angle - expected), Math.cos(angle - expected));
      expect(Math.abs(diff)).toBeLessThan(0.01);
      expect(Math.hypot(x - 100, y - 100)).toBeCloseTo((i / 10 + 0.1) * rim, 1);
    });
    const rows = Array.from(container.querySelectorAll('tbody th')).map((th) => th.textContent);
    expect(rows).toEqual(order.map((k) => (en.hangar.profile.axis as Record<string, string>)[k]));
  });

  it('draws the ghost as a second, dashed polygon', () => {
    const { container } = render(<ShipRadar values={FLAT} ghost={FLAT} label={LABEL} />);
    const ghost = container.querySelector('.kit-radar-ghost') as Element;
    expect(ghost).not.toBeNull();
    expect(vertices(ghost)).toHaveLength(7);
    expect(container.querySelector('.kit-radar-shape')).not.toBeNull();
  });

  it('draws no ghost by default', () => {
    const { container } = render(<ShipRadar values={FLAT} label={LABEL} />);
    expect(container.querySelector('.kit-radar-ghost')).toBeNull();
  });

  it('clamps above 1, and sends negatives and NaN to 0', () => {
    const { container } = render(
      <ShipRadar
        values={{ ...FLAT, cargo: 5, passengers: -3, firepower: NaN, defense: 1 }}
        label={LABEL}
      />,
    );
    const r = radii(shape(container));
    expect(at(r, 0)).toBeCloseTo(at(r, 3), 1);
    expect(at(r, 1)).toBeCloseTo(0, 1);
    expect(at(r, 2)).toBeCloseTo(0, 1);
    const cells = container.querySelectorAll('tbody td');
    expect(cells[0]?.textContent).toBe('100%');
    expect(cells[1]?.textContent).toBe('0%');
    expect(cells[2]?.textContent).toBe('0%');
  });

  it('lists 7 rows with percents in a hidden table', () => {
    const { container } = render(<ShipRadar values={{ ...FLAT, cargo: 0.65 }} label={LABEL} />);
    const table = container.querySelector('table.sr-only') as Element;
    expect(table.querySelectorAll('tbody tr')).toHaveLength(7);
    expect(table.querySelector('tbody td')?.textContent).toBe('65%');
  });

  it('has a label for every axis in en and pt-BR', () => {
    for (const { key } of RADAR_AXES) {
      for (const loc of [en, ptBR]) {
        const text = (loc.hangar.profile.axis as Record<string, string>)[key];
        expect(text).toBeTruthy();
        expect((text ?? '').length).toBeLessThanOrEqual(11);
      }
    }
    expect(Object.keys(en.hangar.profile.axis)).toHaveLength(7);
    expect(ptBR.hangar.profile.title).toBeTruthy();
    expect(en.hangar.profile.title).toBeTruthy();
  });

  it('shows text labels at full size and icons only below 160', () => {
    const big = render(<ShipRadar values={FLAT} label={LABEL} />);
    expect(big.container.querySelectorAll('.kit-radar-label')).toHaveLength(7);
    big.unmount();
    const small = render(<ShipRadar values={FLAT} size={140} label={LABEL} />);
    expect(small.container.querySelectorAll('.kit-radar-label')).toHaveLength(0);
    expect(small.container.querySelectorAll('.kit-radar-axis > svg')).toHaveLength(7);
    expect(small.container.querySelectorAll('.kit-radar-axis path').length).toBeGreaterThanOrEqual(
      7,
    );
    small.unmount();
    const pilot = render(<ShipRadar values={FLAT} size={96} label={LABEL} />);
    expect(pilot.container.querySelectorAll('.kit-radar-label')).toHaveLength(0);
    expect(pilot.container.querySelectorAll('tbody tr')).toHaveLength(7);
  });

  it('hides every icon from assistive tech', () => {
    const { container } = render(<ShipRadar values={FLAT} label={LABEL} />);
    const icons = container.querySelectorAll('.kit-radar-axis svg');
    expect(icons.length).toBeGreaterThanOrEqual(7);
    icons.forEach((svg) => expect(svg.getAttribute('aria-hidden')).toBe('true'));
  });
});

describe('radar labels', () => {
  it.each(RADAR_AXES.map((a, i) => [a.key, i] as const))(
    '%s label stays inside the 200-unit view in both languages',
    (key, i) => {
      const names = [en, ptBR].map(
        (tree) => (tree.hangar.profile.axis as Record<string, string>)[key] ?? '',
      );
      const longest = names.reduce((a, b) => (b.length > a.length ? b : a));
      const box = radarLabelBox(i, longest);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(200);
    },
  );
});
