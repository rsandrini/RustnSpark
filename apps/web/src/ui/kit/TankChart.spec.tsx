import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TankChart } from './TankChart';

const base = { fuel: 45, capacity: 120, caption: 'Fuel is shared by all tanks', label: 'Tanks' };
const three = [
  { id: 'a', capacity: 20 },
  { id: 'b', capacity: 40 },
  { id: 'c', capacity: 60 },
];

describe('TankChart', () => {
  it('draws one glyph per tank, tall in proportion to capacity', () => {
    render(<TankChart {...base} tanks={three} />);
    const heights = screen.getAllByTestId('tank-glyph').map((g) => Number(g.dataset.height));
    expect(heights).toHaveLength(3);
    expect(heights[2]).toBe(64);
    expect(heights[1]! / heights[2]!).toBeCloseTo(40 / 60);
    expect(heights[0]).toBeLessThan(heights[1]!);
  });

  it('fills every tank to the same fraction fuel / capacity and labels each capacity', () => {
    render(<TankChart {...base} tanks={three} />);
    for (const fill of screen.getAllByTestId('tank-fill')) {
      expect(Number(fill.dataset.fraction)).toBeCloseTo(45 / 120);
    }
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByTestId('tank-total')).toHaveTextContent('45 / 120');
    expect(screen.getByText('Fuel is shared by all tanks')).toBeInTheDocument();
  });

  it('shows the target level only when it is above the current fuel', () => {
    const { rerender } = render(<TankChart {...base} tanks={three} />);
    expect(screen.queryByTestId('tank-target')).toBeNull();
    rerender(<TankChart {...base} tanks={three} target={45} />);
    expect(screen.queryByTestId('tank-target')).toBeNull();
    rerender(<TankChart {...base} tanks={three} target={90} />);
    expect(screen.getAllByTestId('tank-target')).toHaveLength(3);
  });

  it('clamps a target above the capacity to the top of the tank', () => {
    render(<TankChart {...base} tanks={[{ id: 'a', capacity: 120 }]} target={500} />);
    const line = screen.getByTestId('tank-target');
    expect(line.getAttribute('y1')).toBe('1');
  });

  it('works with one tank', () => {
    render(<TankChart {...base} tanks={[{ id: 'a', capacity: 120 }]} />);
    expect(screen.getAllByTestId('tank-glyph')).toHaveLength(1);
  });

  it('renders nothing without tanks', () => {
    const { container } = render(<TankChart {...base} tanks={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is an image with the summary as its name', () => {
    render(<TankChart {...base} tanks={three} label="Tanks: 45 of 120 fuel, 3 tanks" />);
    expect(
      screen.getByRole('img', {
        name: 'Tanks: 45 of 120 fuel, 3 tanks. Fuel is shared by all tanks',
      }),
    ).toBeInTheDocument();
  });

  it('scales a full-height fill by --level (animatable)', () => {
    render(<TankChart {...base} fuel={50} capacity={100} tanks={[{ id: 'a', capacity: 100 }]} />);
    const fill = screen.getByTestId('tank-fill');
    const glyph = screen.getByTestId('tank-glyph');
    expect(fill.style.getPropertyValue('--level')).toBe('0.5');
    expect(Number(fill.getAttribute('height'))).toBe(Number(glyph.dataset.height) - 2);
  });

  it('styles the fill with scaleY and a reduced-motion-guarded transition', () => {
    const css = readFileSync(join(__dirname, '../../styles/kit.css'), 'utf8');
    expect(css).toMatch(/\.tank-fill\s*\{[^}]*transform-box:\s*fill-box/);
    expect(css).toMatch(/\.tank-fill\s*\{[^}]*transform:\s*scaleY\(var\(--level/);
    expect(css).toMatch(
      /prefers-reduced-motion: no-preference\) \{(?:[^{}]|\{[^}]*\})*\.tank-fill\s*\{[^}]*transition:\s*transform 1s ease-out/,
    );
  });
});
