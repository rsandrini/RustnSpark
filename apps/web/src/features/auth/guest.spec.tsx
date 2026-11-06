import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { routes } from '../../app/router';

const KEY = 'k'.repeat(43);
const guestProfile = (factionId: string | null = null) => ({
  id: 'guest-1',
  name: 'guest-a1b2c3',
  credits: 0,
  role: 'PLAYER',
  locale: 'en',
  factionId,
  tutorialDone: true,
  isGuest: true,
});

/** A browser with no session cookie: the refresh probe answers 401. */
const noCookie = () =>
  http.post('/v1/auth/refresh', () => HttpResponse.json({ message: 'no' }, { status: 401 }));

describe('playing as a guest', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('"Play as guest" starts a pilot, keeps its key in the browser and goes to the faction choice', async () => {
    server.use(
      noCookie(),
      http.post('/v1/auth/guest', () =>
        HttpResponse.json(
          { accessToken: 'guest-token', guestKey: KEY, player: guestProfile() },
          { status: 201 },
        ),
      ),
      http.get('/v1/players/me', () => HttpResponse.json(guestProfile())),
    );
    renderWithRouter(routes, { initialEntries: ['/login'] });

    await userEvent.click(await screen.findByRole('button', { name: 'Play as guest' }));

    expect(
      await screen.findByRole('heading', { name: /choose your faction/i }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem('rs.guestKey')).toBe(KEY);
  });

  it('reloading with only the key signs the guest back in', async () => {
    window.localStorage.setItem('rs.guestKey', KEY);
    window.localStorage.setItem('rs.signedOut', '1');
    server.use(
      noCookie(),
      http.post('/v1/auth/guest/resume', async ({ request }) => {
        expect(await request.json()).toEqual({ guestKey: KEY });
        return HttpResponse.json({ accessToken: 'back', player: guestProfile('luna') });
      }),
      http.get('/v1/players/me', () => HttpResponse.json(guestProfile('luna'))),
    );
    renderWithRouter(routes, { initialEntries: ['/ship'] });

    expect(await screen.findByRole('heading', { name: 'My Ship' })).toBeInTheDocument();
  });

  it('a frozen or unknown key is forgotten and the sign-in page explains it', async () => {
    window.localStorage.setItem('rs.guestKey', KEY);
    window.localStorage.setItem('rs.signedOut', '1');
    server.use(
      noCookie(),
      http.post('/v1/auth/guest/resume', () =>
        HttpResponse.json({ statusCode: 403, message: { error: 'GUEST_FROZEN' } }, { status: 403 }),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/ship'] });

    expect(await screen.findByRole('alert')).toHaveTextContent(/guest pilot/i);
    expect(window.localStorage.getItem('rs.guestKey')).toBeNull();
  });

  it('a guest sees a Guest label and can save the pilot with an email and password', async () => {
    let claimed = false;
    window.localStorage.setItem('rs.guestKey', KEY);
    server.use(
      http.get('/v1/players/me', () =>
        HttpResponse.json(
          claimed ? { ...guestProfile('luna'), isGuest: false } : guestProfile('luna'),
        ),
      ),
      http.post('/v1/players/me/claim', async ({ request }) => {
        expect(await request.json()).toEqual({ email: 'me@example.com', password: 'secret1' });
        claimed = true;
        return HttpResponse.json({
          accessToken: 'claimed',
          player: { ...guestProfile('luna'), isGuest: false },
        });
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    await screen.findByRole('heading', { name: 'My Ship' });

    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(screen.getByText('Guest pilot')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save your pilot' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/clearing your browser/i);
    await userEvent.type(screen.getByLabelText('Email'), 'me@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'secret1');
    await userEvent.click(screen.getByRole('button', { name: 'Save pilot' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.localStorage.getItem('rs.guestKey')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(screen.queryByText('Guest pilot')).not.toBeInTheDocument();
  });

  it('a taken email keeps the popup open with the conflict message', async () => {
    window.localStorage.setItem('rs.guestKey', KEY);
    server.use(
      http.get('/v1/players/me', () => HttpResponse.json(guestProfile('luna'))),
      http.post('/v1/players/me/claim', () =>
        HttpResponse.json(
          { statusCode: 409, message: 'email or player name is already in use' },
          { status: 409 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    await screen.findByRole('heading', { name: 'My Ship' });
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save your pilot' }));
    await userEvent.type(screen.getByLabelText('Email'), 'used@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'secret1');
    await userEvent.click(screen.getByRole('button', { name: 'Save pilot' }));

    expect(await screen.findByText(/already taken/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('signing out as a guest asks first, because it would lose the pilot', async () => {
    window.localStorage.setItem('rs.guestKey', KEY);
    server.use(http.get('/v1/players/me', () => HttpResponse.json(guestProfile('luna'))));
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    await screen.findByRole('heading', { name: 'My Ship' });

    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/lose this pilot/i);
    await userEvent.click(screen.getByRole('button', { name: 'Keep playing' }));
    expect(window.localStorage.getItem('rs.guestKey')).toBe(KEY);
  });
});
