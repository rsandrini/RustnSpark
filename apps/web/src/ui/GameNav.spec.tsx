import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../test/utils';
import { GameNav } from './GameNav';

// Owner request: Port and Board are reachable straight from the top nav again (reversing the
// round-3 fold), in this order: My Ship, Port, Board, Map. The hangar's own tab row still exists
// too — this nav is an additional way in, not a replacement.
describe('GameNav', () => {
  it('lists My Ship, Port, Board and Map in that order, pointing at the nested hangar routes', () => {
    renderWithProviders(<GameNav />, { initialEntries: ['/hangar'] });
    const nav = screen.getByRole('navigation', { name: 'Game navigation' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['My Ship', 'Port', 'Board', 'Map']);
    expect(links[0]).toHaveAttribute('href', '/hangar');
    expect(links[1]).toHaveAttribute('href', '/hangar/port');
    expect(links[2]).toHaveAttribute('href', '/hangar/board');
    expect(links[3]).toHaveAttribute('href', '/map');
  });

  it('marks "My Ship" active only on /hangar itself, not on /hangar/port or /hangar/board', () => {
    renderWithProviders(<GameNav />, { initialEntries: ['/hangar/port'] });
    expect(screen.getByRole('link', { name: 'My Ship' })).not.toHaveClass('on');
    expect(screen.getByRole('link', { name: 'Port' })).toHaveClass('on');
  });

  it('marks "My Ship" active on plain /hangar', () => {
    renderWithProviders(<GameNav />, { initialEntries: ['/hangar'] });
    expect(screen.getByRole('link', { name: 'My Ship' })).toHaveClass('on');
  });
});
