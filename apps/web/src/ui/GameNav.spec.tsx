import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../test/utils';
import { GameNav } from './GameNav';

// The four places, in this order: Ship, Port, Missions, Map. Their paths are
// /ship, /port, /missions and /map (the old /hangar paths only redirect).
describe('GameNav', () => {
  it('lists Ship, Port, Missions and Map in that order, pointing at /ship, /port, /missions and /map', () => {
    renderWithProviders(<GameNav />, { initialEntries: ['/ship'] });
    const nav = screen.getByRole('navigation', { name: 'Game navigation' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Ship', 'Port', 'Missions', 'Map']);
    expect(links[0]).toHaveAttribute('href', '/ship');
    expect(links[1]).toHaveAttribute('href', '/port');
    expect(links[2]).toHaveAttribute('href', '/missions');
    expect(links[3]).toHaveAttribute('href', '/map');
  });

  it('marks only the link of the current place active (Port on /port, not Ship)', () => {
    renderWithProviders(<GameNav />, { initialEntries: ['/port'] });
    expect(screen.getByRole('link', { name: 'Ship' })).not.toHaveClass('on');
    expect(screen.getByRole('link', { name: 'Port' })).toHaveClass('on');
  });

  it('marks "Ship" active on /ship', () => {
    renderWithProviders(<GameNav />, { initialEntries: ['/ship'] });
    expect(screen.getByRole('link', { name: 'Ship' })).toHaveClass('on');
  });
});
