import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../test/utils';
import { server } from '../test/msw/server';
import { routes } from '../app/router';

const me = () =>
  http.get('/v1/players/me', () =>
    HttpResponse.json(
      {
        id: 'player-1',
        name: 'Test Pilot',
        credits: 0,
        role: 'PLAYER',
        locale: 'en',
        factionId: 'luna',
      },
      { status: 200 },
    ),
  );

describe('TopBar', () => {
  it('shows faction, ship name and current status/location in the middle', async () => {
    server.use(me());
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    expect(await screen.findByRole('heading', { name: 'My Ship' })).toBeInTheDocument();
    const identity = screen.getByText('luna starter').closest('.ship-identity') as HTMLElement;
    expect(identity).not.toBeNull();
    expect(within(identity).getByText('Luna Authority')).toBeInTheDocument();
    expect(within(identity).getByText('luna starter')).toBeInTheDocument();
    expect(within(identity).getByText('Docked at Porto Ceres')).toBeInTheDocument();
  });

  it('shows the last mission link in the top bar when no mission is active', async () => {
    server.use(
      me(),
      http.get('/v1/missions/active', () => HttpResponse.json([], { status: 200 })),
      http.get('/v1/reports', () =>
        HttpResponse.json(
          {
            items: [
              {
                missionId: 'm-last',
                outcome: 'success',
                credits: 100,
                legs: 1,
                createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
                hadCombat: false,
              },
            ],
          },
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    expect(await screen.findByRole('heading', { name: 'My Ship' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Last mission' });
    expect(link).toHaveAttribute('href', '/report/m-last');
    expect(link.closest('.top-bar')).not.toBeNull();
    expect(document.querySelector('.hangar-links-row')).toBeNull();
  });
});
