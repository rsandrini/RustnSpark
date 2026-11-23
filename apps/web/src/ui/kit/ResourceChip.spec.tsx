import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ResourceChip } from './ResourceChip';

function setReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

describe('ResourceChip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('shows the formatted value with the unit', () => {
    render(<ResourceChip label="Credits" value={3000} unit="¢" testId="chip" />);
    expect(screen.getByTestId('chip')).toHaveTextContent('Credits');
    expect(screen.getByTestId('chip')).toHaveTextContent('3,000 ¢');
  });

  it('counts to the new value when it changes (fake timers) and ends exactly on it', () => {
    const { rerender } = render(<ResourceChip label="Scrap" value={10} testId="chip" />);
    rerender(<ResourceChip label="Scrap" value={1000} testId="chip" />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const mid = Number(
      screen
        .getByTestId('chip')
        .textContent?.replace(/\D/g, '')
        .replace(/^Scrap/, ''),
    );
    expect(mid).toBeGreaterThan(10);
    expect(mid).toBeLessThan(1000);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('chip')).toHaveTextContent('1,000');
  });

  it('adds the rise class on an increase and the fall class on a decrease', () => {
    const { rerender } = render(<ResourceChip label="Scrap" value={10} testId="chip" />);
    rerender(<ResourceChip label="Scrap" value={20} testId="chip" />);
    expect(screen.getByTestId('chip')).toHaveClass('kit-chip--rise');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId('chip')).not.toHaveClass('kit-chip--rise');
    rerender(<ResourceChip label="Scrap" value={5} testId="chip" />);
    expect(screen.getByTestId('chip')).toHaveClass('kit-chip--fall');
  });

  it('shows the value at once when prefers-reduced-motion is set', () => {
    setReducedMotion(true);
    const { rerender } = render(<ResourceChip label="Scrap" value={10} testId="chip" />);
    rerender(<ResourceChip label="Scrap" value={1000} testId="chip" />);
    expect(screen.getByTestId('chip')).toHaveTextContent('1,000');
    expect(screen.getByTestId('chip')).not.toHaveClass('kit-chip--rise');
  });

  it('ariaLabel names the chip root and hideLabel keeps the label for assistive tech only', () => {
    render(
      <ResourceChip label="Credits" value={5} testId="chip" ariaLabel="Credits: 5" hideLabel />,
    );
    expect(screen.getByTestId('chip')).toHaveAttribute('aria-label', 'Credits: 5');
    expect(screen.getByText('Credits')).toHaveClass('sr-only');
  });

  it('keeps the label visible by default', () => {
    render(<ResourceChip label="Credits" value={5} testId="chip" />);
    expect(screen.getByText('Credits')).not.toHaveClass('sr-only');
    expect(screen.getByTestId('chip')).not.toHaveAttribute('aria-label');
  });
});
