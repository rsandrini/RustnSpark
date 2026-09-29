import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { InspectorDetailScreen, InspectorListScreen } from './InspectorScreen';

const playerId = 'player-1';

const sheet = {
  account: {
    id: 'account-1',
    email: 'pilot@example.com',
    role: 'PLAYER',
    status: 'ACTIVE',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  player: {
    id: playerId,
    name: 'Stuck Pilot',
    credits: 1200,
    locale: 'en',
    factionId: 'luna',
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  ships: [
    {
      id: 'ship-1',
      name: 'Kestrel',
      status: 'ON_MISSION',
      stance: 'AGGRESSIVE',
      fuel: 12,
      currentLocationId: 'ceres',
    },
  ],
  materials: [{ materialId: 'scrap', quantity: 4 }],
  activeMissions: [
    {
      id: 'mission-1',
      type: 'DELIVERY',
      status: 'ACCEPTED',
      originId: 'ceres',
      destinationId: 'hedus',
      acceptedAt: '2026-09-20T00:00:00.000Z',
    },
  ],
};

const timelinePage1 = {
  items: [
    {
      id: 'event-1',
      at: '2026-09-24T10:00:00.000Z',
      type: 'mission.resolved',
      creditsDelta: 120,
      payload: { missionId: 'mission-done' },
    },
  ],
  nextCursor: 'cursor-1',
};

const timelinePage2 = {
  items: [
    {
      id: 'event-2',
      at: '2026-09-23T10:00:00.000Z',
      type: 'wallet.debit',
      creditsDelta: -30,
      payload: { reason: 'repair.start:ship-1' },
    },
  ],
};

const reports = {
  items: [
    {
      missionId: 'mission-done',
      outcome: 'success',
      credits: 120,
      legs: 2,
      createdAt: '2026-09-24T10:00:00.000Z',
    },
  ],
};

function mockReads() {
  server.use(
    http.get('/v1/admin/players', ({ request }) => {
      const q = new URL(request.url).searchParams.get('q');
      if (q === null) return HttpResponse.json({ items: [] });
      return HttpResponse.json({
        items: [
          {
            id: playerId,
            name: 'Stuck Pilot',
            credits: 1200,
            factionId: 'luna',
            accountEmail: 'pilot@example.com',
            accountStatus: 'ACTIVE',
          },
        ],
      });
    }),
    http.get(`/v1/admin/players/${playerId}`, () => HttpResponse.json(sheet)),
    http.get(`/v1/admin/players/${playerId}/events`, ({ request }) => {
      const cursor = new URL(request.url).searchParams.get('cursor');
      return HttpResponse.json(cursor === null ? timelinePage1 : timelinePage2);
    }),
    http.get(`/v1/admin/players/${playerId}/reports`, () => HttpResponse.json(reports)),
  );
}

function renderDetail() {
  return renderWithRouter(
    [{ path: '/admin/players/:playerId', element: <InspectorDetailScreen /> }],
    { initialEntries: [`/admin/players/${playerId}`] },
  );
}

describe('player inspector list (S11.5 screen D)', () => {
  it('searches players and links each result to its sheet', async () => {
    mockReads();
    const user = userEvent.setup();
    renderWithRouter([{ path: '/admin/players', element: <InspectorListScreen /> }], {
      initialEntries: ['/admin/players'],
    });

    expect(await screen.findByRole('search')).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), 'Stuck');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('link', { name: 'Stuck Pilot' })).toBeInTheDocument();
    expect(screen.getByText('pilot@example.com')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });
});

describe('player sheet (S11.5 screen D)', () => {
  it('renders account, fleet, cargo and the active mission', async () => {
    mockReads();
    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Stuck Pilot' })).toBeInTheDocument();
    expect(screen.getByText('pilot@example.com')).toBeInTheDocument();
    expect(screen.getByText('1200')).toBeInTheDocument();
    expect(screen.getByText('luna')).toBeInTheDocument();
    expect(screen.getByText('Kestrel')).toBeInTheDocument();
    expect(screen.getByText('ON_MISSION')).toBeInTheDocument();
    expect(screen.getByText('scrap')).toBeInTheDocument();
    expect(screen.getByText('DELIVERY')).toBeInTheDocument();
    expect(screen.getByText('hedus')).toBeInTheDocument();
  });

  it('pages the timeline with the cursor until exhausted', async () => {
    mockReads();
    const user = userEvent.setup();
    renderDetail();

    expect(await screen.findByText('mission.resolved')).toBeInTheDocument();
    expect(screen.queryByText('wallet.debit')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('wallet.debit')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument(),
    );
    expect(screen.getByText('mission.resolved')).toBeInTheDocument();
  });
});

describe('support actions (S11.5, S11.4 acceptance)', () => {
  it('requires a reason before a ban can be confirmed and posts it', async () => {
    mockReads();
    let banBody: unknown = null;
    server.use(
      http.post(`/v1/admin/players/${playerId}/ban`, async ({ request }) => {
        banBody = await request.json();
        return HttpResponse.json({
          action: 'SUPPORT_BAN',
          target: playerId,
          before: { status: 'ACTIVE' },
          after: { status: 'BANNED' },
        });
      }),
    );
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Ban' }));
    const dialog = await screen.findByRole('dialog', { name: 'Ban' });
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByLabelText('Reason'), 'repeat offender');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(banBody).toEqual({ reason: 'repeat offender' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('sends grant amounts with the reason and surfaces API rejections', async () => {
    mockReads();
    let grantBody: unknown = null;
    server.use(
      http.post(`/v1/admin/players/${playerId}/credits/grant`, async ({ request }) => {
        grantBody = await request.json();
        return HttpResponse.json(
          {
            statusCode: 409,
            message: { error: 'INSUFFICIENT_FUNDS' },
            requestId: 'req-1',
          },
          { status: 409 },
        );
      }),
    );
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Grant credits' }));
    const dialog = await screen.findByRole('dialog', { name: 'Grant credits' });
    const amount = within(dialog).getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '250');
    await user.type(within(dialog).getByLabelText('Reason'), 'event prize');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(grantBody).toEqual({ amount: 250, reason: 'event prize' }));
    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
  });

  it('requires a 10-128 char password and a reason before it can be sent', async () => {
    mockReads();
    let passwordBody: unknown = null;
    server.use(
      http.post(`/v1/admin/players/${playerId}/password`, async ({ request }) => {
        passwordBody = await request.json();
        return HttpResponse.json({
          action: 'SUPPORT_SET_PASSWORD',
          target: playerId,
          before: { passwordChanged: false },
          after: { passwordChanged: true },
        });
      }),
    );
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Change password' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change password' });
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    const passwordField = within(dialog).getByLabelText('New password');
    expect(confirm).toBeDisabled();

    await user.type(passwordField, 'too-short');
    await user.type(within(dialog).getByLabelText('Reason'), 'pilot locked out');
    expect(confirm).toBeDisabled();

    await user.type(passwordField, '-still-more');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(passwordBody).toEqual({
        password: 'too-short-still-more',
        reason: 'pilot locked out',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('report replay (S11.5 / D19)', () => {
  it('replays a stored report and shows whether it matches the stored log', async () => {
    mockReads();
    server.use(
      http.get(`/v1/admin/players/${playerId}/reports/mission-done/replay`, ({ request }) => {
        const view = new URL(request.url).searchParams.get('view') ?? 'summary';
        return HttpResponse.json({
          missionId: 'mission-done',
          rulesHash: 'rules-abc',
          stored: { outcome: 'success', events: 12 },
          replay: { outcome: 'success', creditsDelta: 120, events: [] },
          matchesStored: true,
          report: {
            locale: 'en',
            outcome: 'success',
            view,
            lines: [
              { text: 'Mission success.', segments: [{ t: 'text', value: 'Mission success.' }] },
            ],
          },
        });
      }),
    );
    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Replay' }));

    expect(await screen.findByText('Replay matches the stored log')).toBeInTheDocument();
    expect(screen.getByText('Stored: success · Replayed: success · 12 events')).toBeInTheDocument();
    expect(screen.getByText('Mission success.')).toBeInTheDocument();
  });
});
