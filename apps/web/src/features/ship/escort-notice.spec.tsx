import { describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/utils';
import { server } from '../../test/msw/server';
import { EscortNotice } from './escort-notice';

const offer = (over: Record<string, unknown> = {}) => ({
  state: 'available',
  reasons: [],
  destinationId: 'ceres',
  durationSeconds: 600,
  arrivesAt: null,
  nextAvailableAt: null,
  ...over,
});

describe('escort notice', () => {
  it('stays hidden when the server offers nothing', async () => {
    renderWithProviders(<EscortNotice />);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.queryByTestId('escort-offer')).toBeNull();
    expect(screen.queryByTestId('escort-underway')).toBeNull();
  });

  it('offers the escort and sends the pilot off when they accept', async () => {
    let started = 0;
    server.use(
      http.get('/v1/ships/:id/escort', () => HttpResponse.json(offer())),
      http.post('/v1/ships/:id/escort', () => {
        started += 1;
        return HttpResponse.json(
          offer({ state: 'underway', arrivesAt: new Date(Date.now() + 600_000).toISOString() }),
        );
      }),
    );
    renderWithProviders(<EscortNotice />);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept the escort' }));
    await waitFor(() => expect(started).toBe(1));
  });

  it('shows the transport on its way', async () => {
    server.use(
      http.get('/v1/ships/:id/escort', () =>
        HttpResponse.json(
          offer({ state: 'underway', arrivesAt: new Date(Date.now() + 600_000).toISOString() }),
        ),
      ),
    );
    renderWithProviders(<EscortNotice />);
    expect(await screen.findByTestId('escort-underway')).toBeInTheDocument();
  });

  it('tells a pilot who waits only for the weekly limit when help comes back', async () => {
    server.use(
      http.get('/v1/ships/:id/escort', () =>
        HttpResponse.json(
          offer({
            state: 'unavailable',
            reasons: ['COOLDOWN'],
            nextAvailableAt: new Date(Date.now() + 86_400_000).toISOString(),
          }),
        ),
      ),
    );
    renderWithProviders(<EscortNotice />);
    expect(await screen.findByTestId('escort-wait')).toBeInTheDocument();
  });
});
