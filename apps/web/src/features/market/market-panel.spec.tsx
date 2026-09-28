import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

async function renderPortMarket(): Promise<void> {
  renderWithRouter(routes, { initialEntries: ['/hangar'] });
  await screen.findByRole('heading', { name: 'My Ship' });
  fireEvent.click(await screen.findByRole('tab', { name: 'Port' }));
  await screen.findByRole('tab', { name: 'Market' });
}

describe('market panel: descriptions and filters', () => {
  beforeEach(() => {
    resetEconomyState();
    server.use(onboarded());
  });

  it('shows every offer with its description, never just a name and a price', async () => {
    await renderPortMarket();
    await screen.findByText('Plated Hull');
    const cards = document.querySelectorAll('.market-panel .pcard');
    expect(cards.length).toBeGreaterThan(0);
    for (const card of Array.from(cards)) {
      expect(card.querySelector('.part-desc-short')?.textContent ?? '').not.toBe('');
    }
  });

  it('opens the full explanation from the info button', async () => {
    await renderPortMarket();
    await screen.findByText('Plated Hull');
    fireEvent.click(screen.getAllByRole('button', { name: /^Details: Plated Hull/ })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Plated Hull' });
    expect(within(dialog).getByText('Why you need it')).toBeInTheDocument();
    expect(within(dialog).getByText(/what it does, why you need it/)).toBeInTheDocument();
  });

  it('filters by part type, by new/used and by search text', async () => {
    await renderPortMarket();
    await screen.findByText('Plated Hull');
    const list = () => document.querySelectorAll('.market-panel .pcard-grid .pcard');
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

  it('shows the pilot balance in the Hangar store', async () => {
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await waitFor(() => {
      if (document.querySelector('rect.block') === null) throw new Error('no block yet');
    });
    const sheet = screen.getByRole('region', { name: 'Ship sheet' });
    expect(sheet.querySelector('.panel')!.textContent).toMatch(/Ship sheet/);

    fireEvent.click(screen.getByRole('tab', { name: 'Store' }));
    expect(await screen.findByTestId('store-balance')).toHaveTextContent('4,820 ¢');
    expect(screen.getByTestId('hangar-balance')).toHaveTextContent('4,820 ¢');
  });

  it('hovering a placed part shows a small stats card — clicking it never opens the full popup', async () => {
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    const block = await waitFor(() => {
      const found = document.querySelector('rect.block');
      if (found === null) throw new Error('no block yet');
      return found;
    });

    fireEvent.pointerDown(block);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('part-hover-card')).toBeNull();

    fireEvent.pointerEnter(block);
    expect(await screen.findByTestId('part-hover-card')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.pointerLeave(block);
    await waitFor(() => expect(screen.queryByTestId('part-hover-card')).not.toBeInTheDocument());
  });
});
