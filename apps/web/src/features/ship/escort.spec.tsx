import { describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/utils';
import { server } from '../../test/msw/server';
import { EscortButton, EscortUnderway, EscortWait } from './escort';

const offer = (over: Record<string, unknown> = {}) => ({
  state: 'available',
  reasons: [],
  destinationId: 'ceres',
  durationSeconds: 600,
  arrivesAt: null,
  nextAvailableAt: null,
  ...over,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

describe('escort entry points', () => {
  it('stay hidden when the server offers nothing', async () => {
    renderWithProviders(
      <>
        <EscortButton />
        <EscortUnderway />
        <EscortWait />
      </>,
    );
    await settle();
    expect(screen.queryByTestId('escort-call')).toBeNull();
    expect(screen.queryByTestId('escort-underway')).toBeNull();
    expect(screen.queryByTestId('escort-wait')).toBeNull();
  });

  it('the compact button asks first, then sends the escort', async () => {
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
    renderWithProviders(<EscortButton />);
    fireEvent.click(await screen.findByRole('button', { name: 'Call the escort' }));
    await settle();
    expect(started).toBe(0); // one click is not enough: the pilot must confirm
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, send the escort' }));
    await waitFor(() => expect(started).toBe(1));
  });

  it('shows the transport on its way as one slim status line, not a panel', async () => {
    server.use(
      http.get('/v1/ships/:id/escort', () =>
        HttpResponse.json(
          offer({ state: 'underway', arrivesAt: new Date(Date.now() + 600_000).toISOString() }),
        ),
      ),
    );
    renderWithProviders(<EscortUnderway />);
    const line = await screen.findByTestId('escort-underway');
    expect(line.tagName).toBe('P');
    expect(line).not.toHaveClass('panel');
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
    renderWithProviders(<EscortWait />);
    expect(await screen.findByTestId('escort-wait')).toBeInTheDocument();
  });
});
