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

  it('shows the podium for the top three and links each to the card, marking the own place', async () => {
    server.use(onboarded());
    renderWithRouter(routes, { initialEntries: ['/rankings'] });

    const podium = await screen.findByTestId('ranking-podium');
    const cols = within(podium).getAllByRole('listitem');
    expect(cols.map((c) => c.getAttribute('data-place'))).toEqual(['2', '1', '3']);
    expect(within(cols[1]!).getByRole('link', { name: 'Mira' })).toHaveAttribute(
      'href',
      '/pilots/mira0000pub1',
    );
    expect(within(cols[1]!).getByText('9,800')).toBeInTheDocument();
    expect(cols[0]).toHaveClass('me');
    // fewer than 4 pilots: no list under the podium
    expect(screen.queryByTestId('ranking-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('ranking-own')).toHaveTextContent(
      'You · rank 2 · +5,600 to pass the next',
    );
  });

  it('lists rank 4 onwards under the podium and marks the own row', async () => {
    const more = [4, 5].map((rank) => ({
      rank,
      publicId: `pub${rank}`,
      name: `Pilot ${rank}`,
      factionId: null,
      value: 100 - rank,
      isMe: rank === 5,
    }));
    server.use(
      onboarded(),
      http.get('/v1/rankings/:board', () =>
        HttpResponse.json(
          rankingFixture({
            entries: [...rankingFixture().entries.map((e) => ({ ...e, isMe: false })), ...more],
            me: { rank: 5, value: 95 },
          }),
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/rankings'] });
    const rows = within(await screen.findByTestId('ranking-list')).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByRole('link', { name: 'Pilot 4' })).toBeInTheDocument();
    expect(rows[1]).toHaveClass('me');
    expect(screen.getByTestId('ranking-own')).toHaveTextContent(
      'You · rank 5 · +1 to pass the next',
    );
  });

  it('anchors the own position when the pilot is below the listed ones, and says so when there is none', async () => {
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
    expect(await screen.findByTestId('ranking-own')).toHaveTextContent('You · rank 312');

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
    await screen.findByTestId('ranking-podium');
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
            entries: [
              {
                rank: 1,
                publicId: 'mira0000pub1',
                name: 'Mira',
                factionId: 'sun',
                value: 185,
                isMe: false,
              },
              {
                rank: 2,
                publicId: 'oro00000pub3',
                name: 'Oro',
                factionId: null,
                value: 200,
                isMe: true,
              },
            ],
            me: { rank: 2, value: 200 },
          }),
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/rankings'] });
    fireEvent.click(await screen.findByRole('tab', { name: 'Fastest race' }));
    const picker = await screen.findByRole('combobox', { name: 'Race route' });
    expect(within(picker).getAllByRole('option')).toHaveLength(2);
    expect(await screen.findByText('3:05')).toBeInTheDocument();
    expect(screen.getByTestId('ranking-own')).toHaveTextContent('-0:15 to pass the next');
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
            entries: [
              {
                rank: 1,
                publicId: 'mira0000pub1',
                name: 'Mira',
                factionId: 'sun',
                value: 15.5,
                isMe: false,
              },
            ],
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

  it('each board is a selectable tab with a name and an aria-hidden icon; the period toggle is one pressed pill', async () => {
    server.use(onboarded());
    renderWithRouter(routes, { initialEntries: ['/rankings'] });
    await screen.findByTestId('ranking-podium');
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs).toHaveLength(6);
    for (const tab of tabs) {
      expect(tab).toHaveAccessibleName();
      expect(tab.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
    expect(screen.getByRole('tab', { name: 'Distance' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Race wins' }));
    expect(screen.getByRole('tab', { name: 'Race wins' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'This week' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'All time' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    expect(screen.getByRole('button', { name: 'All time' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Ship power' }));
    expect(screen.queryByRole('group', { name: 'Period' })).not.toBeInTheDocument();
  });

  it('explains the symbols in a help tip', async () => {
    server.use(onboarded());
    const { container } = renderWithRouter(routes, { initialEntries: ['/rankings'] });
    await screen.findByTestId('ranking-podium');
    const row = container.querySelector('.rankings-boards') as HTMLElement;
    fireEvent.focus(within(row).getByRole('button', { name: 'Help' }));
    const card = screen.getByRole('tooltip');
    const items = within(card).getAllByRole('listitem');
    expect(items).toHaveLength(8);
    for (const name of [
      'Distance',
      'Fights won',
      'Race wins',
      'Race time',
      'Ship power',
      'Ship speed',
    ]) {
      const item = items.find((li) => li.textContent === name);
      expect(item?.querySelector('svg')).not.toBeNull();
    }
    expect(card).toHaveTextContent("The badge is the pilot's faction.");
    expect(card).toHaveTextContent('Your own row is highlighted.');
  });

  it('reads in Portuguese', async () => {
    server.use(onboarded('pt-BR'));
    await i18n.changeLanguage('pt-BR');
    renderWithRouter(routes, { initialEntries: ['/rankings'] });
    expect(await screen.findByRole('tab', { name: 'Lutas vencidas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sempre' })).toBeInTheDocument();
  });
});
