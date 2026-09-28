import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { routes } from '../../app/router';

describe('admin route guard', () => {
  it('redirects a non-admin user away (Home is gone, so this user with no faction lands on onboarding)', async () => {
    server.use(
      http.get('/v1/players/me', () =>
        HttpResponse.json(
          { id: 'p1', name: 'User Pilot', credits: 0, role: 'PLAYER', locale: 'en' },
          { status: 200 },
        ),
      ),
    );

    renderWithRouter(routes, { initialEntries: ['/admin'] });

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: /admin/i })).not.toBeInTheDocument(),
    );
    expect(await screen.findByRole('heading', { name: 'Choose your faction' })).toBeInTheDocument();
  });

  it('renders the admin shell for an admin user', async () => {
    server.use(
      http.get('/v1/players/me', () =>
        HttpResponse.json(
          { id: 'p1', name: 'Admin Pilot', credits: 0, role: 'ADMIN', locale: 'en' },
          { status: 200 },
        ),
      ),
    );

    renderWithRouter(routes, { initialEntries: ['/admin'] });

    expect(await screen.findByRole('heading', { name: /admin/i })).toBeInTheDocument();
  });
});
