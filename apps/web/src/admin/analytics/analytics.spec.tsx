import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/utils';
import { server } from '../../test/msw/server';
import { DashboardScreen } from './DashboardScreen';
import { EconomyScreen } from './EconomyScreen';
import { WorldScreen } from './WorldScreen';

const window = {
  from: '2026-09-18T00:00:00.000Z',
  to: '2026-09-25T00:00:00.000Z',
};

describe('admin analytics screens A–C', () => {
  it('renders the dashboard aggregates including real winrate vs the 55% baseline', async () => {
    server.use(
      http.get('/v1/admin/analytics/dashboard', () =>
        HttpResponse.json({
          window,
          data: {
            players: { new: 13, active: 27 },
            missions: {
              total: 10,
              success: 6,
              partialFailure: 2,
              failed: 2,
              adrift: 0,
              successRate: 0.6,
            },
            combat: { encounters: 8, wins: 4, losses: 4, winrate: 0.5, baseline: 0.55 },
            tiers: { tiers: { 1: 3, 2: 2, 3: 0, 4: 0, 5: 0 }, ships: 5 },
          },
        }),
      ),
    );

    renderWithProviders(<DashboardScreen />);

    await screen.findByText(/Window:/); // data loaded (the heading is there while loading)
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('New players')).toBeInTheDocument();
    expect(screen.getByText('13')).toBeInTheDocument();
    expect(screen.getByText('Active players')).toBeInTheDocument();
    expect(screen.getByText('27')).toBeInTheDocument();
    expect(screen.getByText('6 / 10 (60%)')).toBeInTheDocument();
    expect(screen.getByText('50% (4W / 4L, 8 encounters)')).toBeInTheDocument();
    expect(screen.getByText('55%')).toBeInTheDocument();
    expect(screen.getByText('5 ships in window')).toBeInTheDocument();
  });

  it('renders credits entering vs leaving with the sources and sinks breakdown', async () => {
    server.use(
      http.get('/v1/admin/analytics/economy', () =>
        HttpResponse.json({
          window,
          data: {
            entering: 150,
            leaving: 45,
            net: 105,
            sources: [
              { reason: 'onboarding', total: 100 },
              { reason: 'mission.payout', total: 50 },
            ],
            sinks: [
              { reason: 'repair', total: 30 },
              { reason: 'refuel', total: 15 },
            ],
            adjustments: { granted: 700, removed: 200 },
          },
        }),
      ),
    );

    renderWithProviders(<EconomyScreen />);

    await screen.findByText(/Window:/); // data loaded (the heading is there while loading)
    expect(await screen.findByRole('heading', { name: 'Economy' })).toBeInTheDocument();
    expect(screen.getByText('Credits entering')).toBeInTheDocument();
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('Credits leaving')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('Net')).toBeInTheDocument();
    expect(screen.getByText('105')).toBeInTheDocument();
    expect(screen.getByText('mission.payout')).toBeInTheDocument();
    expect(screen.getByText('refuel')).toBeInTheDocument();
  });

  it('renders route traffic, pirate encounters and zone generation vs consumption', async () => {
    server.use(
      http.get('/v1/admin/analytics/world', () =>
        HttpResponse.json({
          window,
          data: {
            traffic: [
              { routeId: 'route-alpha', crossings: 7 },
              { routeId: 'route-beta', crossings: 2 },
            ],
            encounters: 3,
            zones: [
              { zone: 'inner', generated: 4, consumed: 3 },
              { zone: 'outer', generated: 1, consumed: 2 },
            ],
          },
        }),
      ),
    );

    renderWithProviders(<WorldScreen />);

    await screen.findByText(/Window:/); // data loaded (the heading is there while loading)
    expect(await screen.findByRole('heading', { name: 'World' })).toBeInTheDocument();
    expect(screen.getByText('3 pirate encounters')).toBeInTheDocument();
    expect(screen.getByText('route-alpha')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('inner')).toBeInTheDocument();
    expect(screen.getByText('Generated')).toBeInTheDocument();
    expect(screen.getByText('Consumed')).toBeInTheDocument();
  });

  it('shows the load error instead of an empty screen when the API fails', async () => {
    server.use(
      http.get('/v1/admin/analytics/dashboard', () => HttpResponse.json({}, { status: 500 })),
    );

    renderWithProviders(<DashboardScreen />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('re-queries with an explicit window when the operator picks another period', async () => {
    const seen: URL[] = [];
    server.use(
      http.get('/v1/admin/analytics/economy', ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json({
          window,
          data: {
            entering: 0,
            leaving: 0,
            net: 0,
            sources: [],
            sinks: [],
            adjustments: { granted: 0, removed: 0 },
          },
        });
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<EconomyScreen />);

    await user.selectOptions(await screen.findByLabelText('Period'), '30d');
    await waitFor(() => {
      const last = seen[seen.length - 1]!;
      const days = (Date.now() - new Date(last.searchParams.get('from')!).getTime()) / 86_400_000;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThan(30.1);
    });
  });
});
