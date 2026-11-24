import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { PortsLegend } from './ports-legend';

describe('PortsLegend', () => {
  it('is collapsed by default', () => {
    const { container } = renderWithProviders(<PortsLegend />);
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
  });

  it('shows the three kinds with their dot icons and dot counts', () => {
    const { container } = renderWithProviders(<PortsLegend />);
    for (const [kind, dots] of [
      ['central', 1],
      ['split', 2],
      ['universal', 3],
    ] as const) {
      const row = container.querySelector(`[data-testid="legend-kind-${kind}"]`);
      expect(row).not.toBeNull();
      expect(row?.querySelectorAll(`.kind-icon.conn-kind-${kind} circle`)).toHaveLength(dots);
    }
  });

  it('names the three states in text', () => {
    renderWithProviders(<PortsLegend />);
    for (const state of ['connected', 'available', 'incorrect']) {
      const item = screen.getByTestId(`legend-state-${state}`);
      expect(item.className).toContain(`conn-${state}`);
      expect(item.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it('derives the join table from kindCompatible', () => {
    renderWithProviders(<PortsLegend />);
    const joins = (a: string, b: string) =>
      screen.getByTestId(`legend-join-${a}-${b}`).getAttribute('data-joins');
    expect(joins('central', 'central')).toBe('true');
    expect(joins('split', 'split')).toBe('true');
    expect(joins('central', 'universal')).toBe('true');
    expect(joins('split', 'universal')).toBe('true');
    expect(joins('central', 'split')).toBe('false');
    // the row reads as text, not through an aria-label
    const row = screen.getByTestId('legend-join-central-split');
    expect(row).not.toHaveAttribute('aria-label');
    expect(row).toHaveTextContent('Central + Split:');
    expect(row).toHaveTextContent('does not join');
  });
});
