import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { routes } from '../../app/router';

const guest = (isGuest: boolean) => ({
  id: 'guest-1',
  name: 'guest-a1b2c3',
  credits: 0,
  role: 'PLAYER',
  locale: 'en',
  factionId: 'luna',
  tutorialDone: true,
  isGuest,
});

describe('the reminder to save a guest pilot', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows once, when a guest reads a report, and opens the save popup from its button', async () => {
    server.use(http.get('/v1/players/me', () => HttpResponse.json(guest(true))));
    const { unmount } = renderWithRouter(routes, { initialEntries: ['/report/some-mission'] });

    expect(await screen.findByRole('status')).toHaveTextContent(/only kept by this browser/i);
    await userEvent.click(screen.getByRole('button', { name: 'Save your pilot' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(/clearing your browser/i);

    // not again on the next report
    unmount();
    renderWithRouter(routes, { initialEntries: ['/report/another-mission'] });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('never shows to a pilot who is not a guest', async () => {
    server.use(http.get('/v1/players/me', () => HttpResponse.json(guest(false))));
    renderWithRouter(routes, { initialEntries: ['/report/some-mission'] });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
