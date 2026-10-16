import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../test/utils';
import { GameNav } from './GameNav';

// The four places, in this order: My Ship, Port, Board (the Missions route), Map. Their paths are
// /ship, /port, /missions and /map (the old /hangar paths only redirect).
describe('GameNav', () => {
  it('lists My Ship, Port, Board and Map in that order, pointing at /ship, /port, /missions and /map', () => {
    renderWithProviders(<GameNav />, { initialEntries: ['/ship'] });
    const nav = screen.getByRole('navigation', { name: 'Game navigation' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['My Ship', 'Port', 'Board', 'Map']);
    expect(links[0]).toHaveAttribute('href', '/ship');
    expect(links[1]).toHaveAttribute('href', '/port');
    expect(links[2]).toHaveAttribute('href', '/missions');
    expect(links[3]).toHaveAttribute('href', '/map');
  });

  it('marks only the link of the current place active (Port on /port, not My Ship)', () => {
    renderWithProviders(<GameNav />, { initialEntries: ['/port'] });
    expect(screen.getByRole('link', { name: 'My Ship' })).not.toHaveClass('on');
    expect(screen.getByRole('link', { name: 'Port' })).toHaveClass('on');
  });

  it('marks "My Ship" active on /ship', () => {
    renderWithProviders(<GameNav />, { initialEntries: ['/ship'] });
    expect(screen.getByRole('link', { name: 'My Ship' })).toHaveClass('on');
  });
});
