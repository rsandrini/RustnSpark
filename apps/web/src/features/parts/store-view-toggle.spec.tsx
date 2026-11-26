import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { StoreViewToggle, STORE_VIEW_KEY, readStoreView, useStoreView } from './store-view-toggle';

function Harness() {
  const [view, setView] = useStoreView();
  return <StoreViewToggle value={view} onChange={setView} />;
}

describe('StoreViewToggle', () => {
  beforeEach(() => window.localStorage.removeItem(STORE_VIEW_KEY));

  it('defaults to cards, switches to list and remembers it', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole('button', { name: 'Cards' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem(STORE_VIEW_KEY)).toBe('list');
    expect(readStoreView()).toBe('list');
  });

  it('falls back to cards for a junk value', () => {
    window.localStorage.setItem(STORE_VIEW_KEY, 'nope');
    expect(readStoreView()).toBe('cards');
  });
});

describe('StoreViewToggle icons', () => {
  it('is two icon buttons named by their labels', () => {
    renderWithProviders(<StoreViewToggle value="list" onChange={() => undefined} />);
    for (const name of ['Cards', 'List']) {
      const button = screen.getByRole('button', { name });
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.textContent).toBe('');
    }
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Cards' })).toHaveAttribute('aria-pressed', 'false');
  });
});
