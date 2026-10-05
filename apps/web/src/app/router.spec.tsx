import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
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
    // Home was retired (round-3): a signed-out visit to '/' lands straight on the sign-in page.
    renderWithRouter(routes);
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /create an account/i }));
    expect(screen.getByRole('heading', { name: /create account/i })).toBeInTheDocument();
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
    // The redirect completes after the refresh fails; wait for where it lands rather than
    // asserting the absence of the admin page (true before anything has rendered).
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByText(/admin dashboard/i)).not.toBeInTheDocument();
  });

  it('keeps a signed-out visitor on /register instead of bouncing them to /login', async () => {
    server.use(
      http.post('/v1/auth/refresh', () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/register'] });
    // The silent session restore fails for a visitor with no cookie; that must not redirect a
    // public route (it did: every direct visit to /register landed on the sign-in page).
    expect(
      await screen.findByRole('heading', { name: /create account|register/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('switches the login screen to Portuguese with the language switcher and remembers it', async () => {
    server.use(
      http.post('/v1/auth/refresh', () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
      ),
    );
    const user = userEvent.setup();
    renderWithRouter(routes, { initialEntries: ['/login'] });

    await user.selectOptions(await screen.findByLabelText(/language/i), 'pt-BR');

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(window.localStorage.getItem('rs.language')).toBe('pt-BR');
    await user.selectOptions(screen.getByLabelText('Idioma'), 'en');
    window.localStorage.removeItem('rs.language');
  });
});
