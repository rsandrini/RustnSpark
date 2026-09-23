import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { routes } from '../../app/router';

function mockAdminUser() {
  server.use(
    http.get('/v1/players/me', () =>
      HttpResponse.json(
        { id: 'p1', name: 'Admin Pilot', credits: 0, role: 'ADMIN', locale: 'en' },
        { status: 200 },
      ),
    ),
  );
}

function mockNonAdminUser() {
  server.use(
    http.get('/v1/players/me', () =>
      HttpResponse.json(
        { id: 'p1', name: 'User Pilot', credits: 0, role: 'PLAYER', locale: 'en' },
        { status: 200 },
      ),
    ),
  );
}

describe('admin tuning routing', () => {
  it('renders the config screen for an admin user', async () => {
    mockAdminUser();
    server.use(
      http.get('/v1/admin/tuning/config', () =>
        HttpResponse.json(
          [
            {
              key: 'economy.start_credits',
              group: 'economy',
              type: 'integer',
              min: 0,
              max: 10000,
              unit: '¢',
              description: {
                en: 'Starting credits for a new player.',
                'pt-BR': 'Créditos iniciais para um novo jogador.',
              },
              currentValue: 1000,
              factoryDefault: 1000,
              modified: false,
            },
          ],
          { status: 200 },
        ),
      ),
      http.get('/v1/admin/tuning/revisions', () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    renderWithRouter(routes, { initialEntries: ['/admin/tuning/config'] });

    expect(
      await screen.findByRole('heading', { name: /tuning/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: /search/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('economy.start_credits')).toBeInTheDocument();
  });

  it('redirects a non-admin user away from /admin/tuning/config', async () => {
    mockNonAdminUser();
    renderWithRouter(routes, { initialEntries: ['/admin/tuning/config'] });

    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: /tuning/i }),
      ).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole('heading', { name: /home/i }),
    ).toBeInTheDocument();
  });

  it('navigates between tuning sections from the admin shell', async () => {
    mockAdminUser();
    server.use(
      http.get('/v1/admin/tuning/config', () =>
        HttpResponse.json([], { status: 200 }),
      ),
      http.get('/v1/admin/tuning/revisions', () =>
        HttpResponse.json([], { status: 200 }),
      ),
      http.get('/v1/admin/tuning/schema/materials', () =>
        HttpResponse.json(
          {
            entity: 'materials',
            fields: [
              {
                name: 'id',
                type: 'string',
                required: true,
                description: {
                  en: 'Unique material id',
                  'pt-BR': 'ID único do material',
                },
              },
            ],
          },
          { status: 200 },
        ),
      ),
      http.get('/v1/admin/tuning/materials', () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    const user = userEvent.setup();
    renderWithRouter(routes, { initialEntries: ['/admin/tuning/config'] });

    expect(
      await screen.findByRole('heading', { name: /tuning/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /entities/i }));
    expect(
      await screen.findByRole('heading', { name: /materials/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: /revision history/i }));
    expect(
      await screen.findByRole('heading', { name: /revision history/i }),
    ).toBeInTheDocument();
  });
});
