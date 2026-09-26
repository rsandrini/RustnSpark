import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { routes } from '../../app/router';

function profileHandler(getFaction: () => string | null) {
  return http.get('/v1/players/me', () =>
    HttpResponse.json(
      {
        id: 'player-1',
        name: 'Test Pilot',
        credits: 0,
        role: 'PLAYER',
        locale: 'en',
        factionId: getFaction(),
      },
      { status: 200 },
    ),
  );
}

describe('onboarding (S10.2)', () => {
  it('shows all playable factions with the launch button disabled until one is picked', async () => {
    renderWithRouter(routes, { initialEntries: ['/onboarding'] });

    expect(
      await screen.findByRole('heading', { name: /choose your faction/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/luna authority/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sun traders/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/explorers/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /launch/i })).toBeDisabled();
  });

  it('posts the chosen faction, reloads the profile and leaves the screen', async () => {
    let faction: string | null = null;
    const requests: unknown[] = [];
    server.use(
      profileHandler(() => faction),
      http.post('/v1/players/me/onboarding', async ({ request }) => {
        requests.push(await request.json());
        faction = 'sun';
        return HttpResponse.json({ id: 'ship-1' }, { status: 200 });
      }),
    );

    const user = userEvent.setup();
    renderWithRouter(routes, { initialEntries: ['/onboarding'] });

    await user.click(await screen.findByLabelText(/sun traders/i));
    await user.click(screen.getByRole('button', { name: /launch/i }));

    expect(await screen.findByRole('heading', { name: /hangar/i })).toBeInTheDocument();
    expect(requests).toEqual([{ faction: 'sun' }]);
  });

  it('keeps an already-onboarded pilot away from the picker', async () => {
    server.use(profileHandler(() => 'luna'));

    renderWithRouter(routes, { initialEntries: ['/onboarding'] });

    expect(await screen.findByRole('heading', { name: /home/i })).toBeInTheDocument();
  });

  it('surfaces a translated server rejection', async () => {
    server.use(
      profileHandler(() => null),
      http.post('/v1/players/me/onboarding', () =>
        HttpResponse.json(
          { statusCode: 400, message: { error: 'UNKNOWN_FACTION' } },
          { status: 400 },
        ),
      ),
    );

    const user = userEvent.setup();
    renderWithRouter(routes, { initialEntries: ['/onboarding'] });

    await user.click(await screen.findByLabelText(/luna authority/i));
    await user.click(screen.getByRole('button', { name: /launch/i }));

    expect(await screen.findByText(/not playable/i)).toBeInTheDocument();
  });
});
