import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../test/utils';
import { server } from '../test/msw/server';
import { routes } from './router';

describe('router', () => {
  it('navigates between public routes', async () => {
    server.use(
      http.post('/v1/auth/refresh', () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
      ),
    );

    const user = userEvent.setup();
    renderWithRouter(routes);

    await user.click(screen.getByRole('link', { name: /sign in/i }));
    expect(
      screen.getByRole('heading', { name: /sign in/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /create an account/i }));
    expect(
      screen.getByRole('heading', { name: /create account/i }),
    ).toBeInTheDocument();
  });

  it('shows the not found page for unknown routes', async () => {
    renderWithRouter(routes, { initialEntries: ['/unknown-route'] });
    expect(await screen.findByText(/page not found/i)).toBeInTheDocument();
  });

  it('redirects unauthenticated users away from /admin', async () => {
    server.use(
      http.post('/v1/auth/refresh', () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/admin'] });
    await waitFor(() =>
      expect(screen.queryByText(/admin dashboard/i)).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });
});
