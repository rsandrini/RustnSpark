import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { economyState, resetEconomyState } from '../../test/msw/handlers';
import { routes } from '../../app/router';

const onboarded = () =>
  http.get('/v1/players/me', () =>
    HttpResponse.json(
      {
        id: 'player-1',
        name: 'Test Pilot',
        credits: economyState.wallet,
        role: 'PLAYER',
        locale: 'en',
        factionId: 'luna',
      },
      { status: 200 },
    ),
  );

const panel = () => document.querySelector('.market-panel') as HTMLElement;

describe('market panel: descriptions and filters', () => {
  beforeEach(() => {
    resetEconomyState();
    server.use(onboarded());
  });

  it('shows every offer with its description, never just a name and a price', async () => {
    renderWithRouter(routes, { initialEntries: ['/port'] });
    await screen.findByText('Plated Hull');
    const cards = document.querySelectorAll('.market-panel .item');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of Array.from(cards)) {
      expect(card.querySelector('.part-desc-short')?.textContent ?? '').not.toBe('');
    }
  });

  it('opens the full explanation from the info button', async () => {
    renderWithRouter(routes, { initialEntries: ['/port'] });
    await screen.findByText('Plated Hull');
    fireEvent.click(screen.getAllByRole('button', { name: /^Details: Plated Hull/ })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Plated Hull' });
    expect(within(dialog).getByText('Why you need it')).toBeInTheDocument();
    expect(within(dialog).getByText(/what it does, why you need it/)).toBeInTheDocument();
  });

  it('filters by part type, by new/used and by search text', async () => {
    renderWithRouter(routes, { initialEntries: ['/port'] });
    await screen.findByText('Plated Hull');
    const list = () => document.querySelectorAll('.market-panel .grid-cards .item');
    const total = list().length;

    fireEvent.click(screen.getByRole('button', { name: 'Defense' }));
    expect(list()).toHaveLength(1);
    expect(within(panel()).queryByText('Cargo Rack')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(list()).toHaveLength(total);

    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'used' } });
    expect(list()).toHaveLength(1);
    expect(within(panel()).getByText('Cargo Rack (used)')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Search parts'), { target: { value: 'zzz' } });
    expect(list()).toHaveLength(0);
    expect(screen.getByText('No parts match these filters.')).toBeInTheDocument();
  });
});
