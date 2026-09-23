import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/utils';
import { server } from '../../test/msw/server';
import { ConfigScreen } from './ConfigScreen';

const configEntries = [
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
    currentValue: 1500,
    factoryDefault: 1000,
    modified: true,
  },
  {
    key: 'combat.dc_base',
    group: 'combat',
    type: 'integer',
    min: 1,
    max: 50,
    description: {
      en: 'Base difficulty class for attack rolls.',
      'pt-BR': 'Classe de dificuldade base para rolagens de ataque.',
    },
    currentValue: 10,
    factoryDefault: 10,
    modified: false,
  },
  {
    key: 'fake.new_key',
    group: 'fake',
    type: 'integer',
    min: 0,
    max: 100,
    description: {
      en: 'Fake registered key.',
      'pt-BR': 'Chave registrada falsa.',
    },
    currentValue: 42,
    factoryDefault: 0,
    modified: true,
  },
];

describe('ConfigScreen', () => {
  it('renders config keys grouped by domain with descriptions', async () => {
    server.use(
      http.get('/v1/admin/tuning/config', () =>
        HttpResponse.json(configEntries, { status: 200 }),
      ),
      http.get('/v1/admin/tuning/revisions', () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    renderWithProviders(<ConfigScreen />);

    expect(
      await screen.findByText('economy.start_credits'),
    ).toBeInTheDocument();
    expect(screen.getByText(/starting credits/i)).toBeInTheDocument();
    expect(screen.getByText('combat.dc_base')).toBeInTheDocument();
    expect(screen.getByText(/difficulty class/i)).toBeInTheDocument();
    expect(screen.getByText('fake.new_key')).toBeInTheDocument();
  });

  it('shows the modified badge only on modified keys', async () => {
    server.use(
      http.get('/v1/admin/tuning/config', () =>
        HttpResponse.json(configEntries, { status: 200 }),
      ),
      http.get('/v1/admin/tuning/revisions', () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    renderWithProviders(<ConfigScreen />);
    await screen.findByText('economy.start_credits');

    const modifiedBadge = screen.getAllByText(/modified/i);
    expect(modifiedBadge.length).toBeGreaterThanOrEqual(2);
  });

  it('filters keys by search query', async () => {
    server.use(
      http.get('/v1/admin/tuning/config', () =>
        HttpResponse.json(configEntries, { status: 200 }),
      ),
      http.get('/v1/admin/tuning/revisions', () =>
        HttpResponse.json([], { status: 200 }),
      ),
    );

    const user = userEvent.setup();
    renderWithProviders(<ConfigScreen />);
    await screen.findByText('economy.start_credits');

    await user.type(screen.getByRole('textbox', { name: /search/i }), 'combat');

    await waitFor(() => {
      expect(screen.queryByText('economy.start_credits')).not.toBeInTheDocument();
    });
    expect(screen.getByText('combat.dc_base')).toBeInTheDocument();
  });

  it('saves a changed value via PATCH', async () => {
    const savedBodies: unknown[] = [];
    server.use(
      http.get('/v1/admin/tuning/config', () =>
        HttpResponse.json(configEntries, { status: 200 }),
      ),
      http.get('/v1/admin/tuning/revisions', () =>
        HttpResponse.json(
          [
            {
              id: '5',
              actor: 'admin',
              entityType: 'GameConfig',
              entityId: 'economy.start_credits',
              before: 1000,
              after: 1500,
              reason: 'initial',
              createdAt: new Date().toISOString(),
            },
          ],
          { status: 200 },
        ),
      ),
      http.patch('/v1/admin/tuning/config/economy.start_credits', async ({ request }) => {
        const body = await request.json();
        savedBodies.push(body);
        return HttpResponse.json(
          { id: '6', actor: 'admin', entityType: 'GameConfig', entityId: 'economy.start_credits', before: 1500, after: 2000, reason: 'tuning', createdAt: new Date().toISOString() },
          { status: 200 },
        );
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<ConfigScreen />);
    await screen.findByText('economy.start_credits');

    const input = screen.getByRole('spinbutton', {
      name: /economy\.start_credits/i,
    });
    await user.clear(input);
    await user.type(input, '2000');

    await user.click(
      screen.getByRole('button', { name: /save economy\.start_credits/i }),
    );

    await waitFor(() => {
      expect(savedBodies.length).toBeGreaterThan(0);
    });

    const body = savedBodies[0] as Record<string, unknown>;
    expect(body).toMatchObject({
      value: 2000,
      expectedRevision: 5,
    });
    expect(typeof body.reason).toBe('string');
  });

  it('resets a key to factory default via POST', async () => {
    let resetCalled = false;
    server.use(
      http.get('/v1/admin/tuning/config', () =>
        HttpResponse.json(configEntries, { status: 200 }),
      ),
      http.get('/v1/admin/tuning/revisions', () =>
        HttpResponse.json([], { status: 200 }),
      ),
      http.post('/v1/admin/tuning/config/economy.start_credits/reset', () => {
        resetCalled = true;
        return HttpResponse.json(
          { id: '7', actor: 'admin', entityType: 'GameConfig', entityId: 'economy.start_credits', before: 1500, after: 1000, reason: 'reset', createdAt: new Date().toISOString() },
          { status: 200 },
        );
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<ConfigScreen />);
    await screen.findByText('economy.start_credits');

    await user.click(
      screen.getByRole('button', { name: /reset economy\.start_credits/i }),
    );
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(resetCalled).toBe(true);
    });
  });
});
