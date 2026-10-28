import { describe, it, expect, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { routes } from '../../app/router';
import i18n from '../../i18n';
import { raceRoutesFixture, rankingFixture } from './rankings-fixtures';

const onboarded = (locale = 'en') =>
  http.get('/v1/players/me', () =>
    HttpResponse.json(
      {
        id: 'player-1',
        name: 'Test Pilot',
        credits: 100,
        role: 'PLAYER',
        locale,
        factionId: 'luna',
      },
      { status: 200 },
    ),
  );

describe('rankings page', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('lists the pilots with rank, name and value, links each to the card and marks the own row', async () => {
    server.use(onboarded());
    renderWithRouter(routes, { initialEntries: ['/rankings'] });

    const list = await screen.findByTestId('ranking-list');
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('1')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('link', { name: 'Mira' })).toHaveAttribute(
      'href',
      '/pilots/Mira',
    );
    expect(within(rows[0]!).getByText('9,800')).toBeInTheDocument();
    expect(rows[1]).toHaveClass('me');
    // the own row is in the list, so no separate pinned line
    expect(screen.queryByTestId('ranking-own')).not.toBeInTheDocument();
  });

  it('pins the own position when the pilot is below the listed ones, and says so when there is none', async () => {
    server.use(
      onboarded(),
      http.get('/v1/rankings/:board', () =>
        HttpResponse.json(
          rankingFixture({
            entries: rankingFixture().entries.map((entry) => ({ ...entry, isMe: false })),
            me: { rank: 312, value: 40 },
            total: 400,
          }),
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/rankings'] });
    expect(await screen.findByTestId('ranking-own')).toHaveTextContent('You are number 312 (40)');

    server.use(
      http.get('/v1/rankings/:board', () =>
        HttpResponse.json(rankingFixture({ entries: [], me: null, total: 0 })),
      ),
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Fights won' }));
    expect(await screen.findByText('Nobody is on this board yet.')).toBeInTheDocument();
    expect(screen.getByTestId('ranking-own')).toHaveTextContent(
      'You have no result on this board yet.',
    );
  });

  it('asks for the board and period the pilot picks', async () => {
    const asked: string[] = [];
    server.use(
      onboarded(),
      http.get('/v1/rankings/:board', ({ request }) => {
        asked.push(new URL(request.url).pathname + new URL(request.url).search);
        return HttpResponse.json(rankingFixture());
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/rankings'] });
    await screen.findByTestId('ranking-list');
    expect(asked).toContain('/v1/rankings/distance?window=weekly');
    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    await waitFor(() => expect(asked).toContain('/v1/rankings/distance?window=lifetime'));
    fireEvent.click(screen.getByRole('tab', { name: 'Race wins' }));
    await waitFor(() => expect(asked).toContain('/v1/rankings/race_wins?window=lifetime'));
  });

  it('the race board has a route picker with place names and shows times as m:ss', async () => {
    server.use(
      onboarded(),
      http.get('/v1/rankings/race-routes', () => HttpResponse.json(raceRoutesFixture())),
      http.get('/v1/rankings/:board', ({ request }) =>
        HttpResponse.json(
          rankingFixture({
            board: 'race_time',
            route: new URL(request.url).searchParams.get('route'),
            entries: [{ rank: 1, name: 'Mira', factionId: 'sun', value: 185, isMe: false }],
            me: null,
          }),
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/rankings'] });
    fireEvent.click(await screen.findByRole('tab', { name: 'Fastest race' }));
    const picker = await screen.findByRole('combobox', { name: 'Race route' });
    expect(within(picker).getAllByRole('option')).toHaveLength(2);
    expect(await screen.findByText('3:05')).toBeInTheDocument();
  });

  it('the ship boards have no period toggle and show one decimal', async () => {
    const asked: string[] = [];
    server.use(
      onboarded(),
      http.get('/v1/rankings/:board', ({ request }) => {
        asked.push(new URL(request.url).pathname + new URL(request.url).search);
        return HttpResponse.json(
          rankingFixture({
            board: 'ship_speed',
            window: 'lifetime',
            entries: [{ rank: 1, name: 'Mira', factionId: 'sun', value: 15.5, isMe: false }],
            me: null,
          }),
        );
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/rankings'] });
    fireEvent.click(await screen.findByRole('tab', { name: 'Ship speed' }));
    expect(await screen.findByText('15.5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'This week' })).not.toBeInTheDocument();
    expect(screen.getByText(/refreshed periodically/)).toBeInTheDocument();
    expect(asked).toContain('/v1/rankings/ship_speed?window=lifetime');
  });

  it('reads in Portuguese', async () => {
    server.use(onboarded('pt-BR'));
    await i18n.changeLanguage('pt-BR');
    renderWithRouter(routes, { initialEntries: ['/rankings'] });
    expect(await screen.findByRole('tab', { name: 'Lutas vencidas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sempre' })).toBeInTheDocument();
  });
});
