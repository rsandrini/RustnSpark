import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/utils';
import { server } from '../../test/msw/server';
import { SystemScreen } from './SystemScreen';

const flags = [
  {
    key: 'maintenance',
    value: false,
    updatedAt: '2026-09-20T00:00:00.000Z',
    updatedBy: 'admin-1',
  },
  {
    key: 'register.open',
    value: true,
    updatedAt: '2026-09-21T00:00:00.000Z',
    updatedBy: 'admin-1',
  },
];

const notices = [
  {
    id: 'notice-1',
    message: { en: 'Server restart at 22:00', 'pt-BR': 'Reinício às 22:00' },
    active: true,
    createdBy: 'admin-1',
    createdAt: '2026-09-22T00:00:00.000Z',
    dismissedAt: null,
  },
];

function mockFlags() {
  server.use(http.get('/v1/admin/system/flags', () => HttpResponse.json(flags)));
}

describe('system screen (S11.5 screen E)', () => {
  it('lists flags with labels and requires confirmation before flipping one', async () => {
    mockFlags();
    let putBody: unknown = null;
    server.use(
      http.put('/v1/admin/system/flags/maintenance', async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({
          key: 'maintenance',
          value: true,
          updatedAt: '2026-09-25T00:00:00.000Z',
          updatedBy: 'admin-1',
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<SystemScreen />);

    expect(await screen.findByText('Maintenance mode')).toBeInTheDocument();
    expect(screen.getByText('Open registration')).toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();

    // No flip without the confirmation step.
    await user.click(screen.getByRole('button', { name: 'Toggle Maintenance mode' }));
    expect(putBody).toBeNull();

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/Toggle the Maintenance mode flag/i);
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(putBody).toEqual({ value: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('publishes a bilingual broadcast and dismisses one with confirmation', async () => {
    mockFlags();
    server.use(http.get('/v1/admin/system/notices', () => HttpResponse.json(notices)));

    let created: unknown = null;
    server.use(
      http.post('/v1/admin/system/notices', async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({
          id: 'notice-2',
          message: { en: 'Double XP weekend', 'pt-BR': 'Fim de semana de XP duplo' },
          active: true,
          createdBy: 'admin-1',
          createdAt: '2026-09-25T00:00:00.000Z',
          dismissedAt: null,
        });
      }),
    );
    let dismissedId: string | null = null;
    server.use(
      http.post('/v1/admin/system/notices/:id/dismiss', ({ params }) => {
        dismissedId = String(params.id);
        return HttpResponse.json({}); // response body unused by the screen
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<SystemScreen />);

    expect(await screen.findByText('Server restart at 22:00')).toBeInTheDocument();

    // The publish button stays disabled until both locales are filled.
    const publish = screen.getByRole('button', { name: 'Publish' });
    expect(publish).toBeDisabled();
    await user.type(screen.getByLabelText('Notice (en)'), 'Double XP weekend');
    await user.type(screen.getByLabelText('Notice (pt-BR)'), 'Fim de semana de XP duplo');
    expect(publish).toBeEnabled();
    await user.click(publish);

    await waitFor(() =>
      expect(created).toEqual({
        message: { en: 'Double XP weekend', 'pt-BR': 'Fim de semana de XP duplo' },
      }),
    );

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(dismissedId).toBe('notice-1'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('says why a flag flip, a notice or a dismissal failed, instead of failing silently', async () => {
    mockFlags();
    server.use(
      http.get('/v1/admin/system/notices', () => HttpResponse.json(notices)),
      http.put('/v1/admin/system/flags/:key', () =>
        HttpResponse.json({ statusCode: 403, message: 'admin only (test)' }, { status: 403 }),
      ),
      http.post('/v1/admin/system/notices', () =>
        HttpResponse.json(
          { statusCode: 400, message: ['message.en must be shorter than or equal to 500 characters'] },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<SystemScreen />);

    await user.type(await screen.findByLabelText('Notice (en)'), 'x');
    await user.type(screen.getByLabelText('Notice (pt-BR)'), 'y');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/message\.en must be shorter/)).toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Toggle Maintenance mode' }));
    const dialog = await screen.findByRole('dialog', { name: 'Toggle' });
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByText(/admin only \(test\)/)).toBeInTheDocument();
  });
});
