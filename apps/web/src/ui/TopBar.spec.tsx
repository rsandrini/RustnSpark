import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  it('shows faction, ship name and current status/location in the status strip', async () => {
    server.use(me());
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    expect(await screen.findByRole('heading', { name: 'My Ship' })).toBeInTheDocument();
    const identity = screen
      .getAllByText('luna starter')[0]!
      .closest('.ship-identity') as HTMLElement;
    expect(identity).not.toBeNull();
    expect(within(identity).getByText('Luna Authority')).toBeInTheDocument();
    expect(within(identity).getByText('luna starter')).toBeInTheDocument();
    expect(
      within(identity).getByText('Docked at Porto Ceres · 3 pilots docked'),
    ).toBeInTheDocument();
  });

  it('shows the last mission link in the status strip when no mission is active', async () => {
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
    expect(link.closest('.status-strip')).not.toBeNull();
    expect(document.querySelector('.hangar-links-row')).toBeNull();
  });

  it('lets the pilot change the battery management from the engine tuning, not the top bar', async () => {
    let postedMode: string | null = null;
    server.use(
      me(),
      http.post('/v1/ships/:id/energy-mode', async ({ request }) => {
        const body = (await request.json()) as { energyMode: string };
        postedMode = body.energyMode;
        return HttpResponse.json({ ...body }, { status: 200 });
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    expect(await screen.findByRole('heading', { name: 'My Ship' })).toBeInTheDocument();
    const identity = screen
      .getAllByText('luna starter')[0]!
      .closest('.ship-identity') as HTMLElement;
    expect(within(identity).queryByRole('combobox')).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Engine tuning' }));
    const tuning = await screen.findByRole('group', { name: 'Engine tuning' });
    const select = within(tuning).getByRole('combobox', { name: 'Energy' });
    expect(select).toHaveValue('FULL');
    await userEvent.selectOptions(select, 'BATTERY');
    await waitFor(() => expect(postedMode).toBe('BATTERY'));
  });

  it('shows the release version at the bottom of the account menu', async () => {
    server.use(me());
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    expect(await screen.findByRole('heading', { name: 'My Ship' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(await screen.findByTestId('app-version')).toHaveTextContent('v0.1');
  });

  it('opens the report-a-problem dialog on the page body, not inside the top bar', async () => {
    server.use(me());
    renderWithRouter(routes, { initialEntries: ['/hangar'] });
    expect(await screen.findByRole('heading', { name: 'My Ship' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    await userEvent.click(await screen.findByRole('button', { name: /report a problem/i }));
    const dialog = await screen.findByRole('dialog');
    // inside the top bar's blur layer a fixed popup is anchored to the bar and half off the screen
    expect(dialog.closest('.shell-top')).toBeNull();
    expect(dialog.closest('.modal-backdrop')?.parentElement).toBe(document.body);
  });
});
