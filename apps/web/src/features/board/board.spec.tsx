import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { resetBoardState } from '../../test/msw/handlers';
import { routes } from '../../app/router';

const onboarded = () =>
  http.get('/v1/players/me', () =>
    HttpResponse.json(
      {
        id: 'player-1',
        name: 'Test Pilot',
        credits: 0,
        role: 'PLAYER',
        locale: 'en',
        factionId: 'luna',
      },
      { status: 200 },
    ),
  );

async function renderBoard(extra = ''): Promise<void> {
  renderWithRouter(routes, { initialEntries: [`/hangar${extra}`] });
  await screen.findByRole('heading', { name: 'My Ship' });
  fireEvent.click(await screen.findByRole('tab', { name: 'Board' }));
  // Board's own type-filter tabs only render once its offers have loaded.
  await screen.findByRole('tab', { name: 'All missions' });
}

describe('board (S10.6)', () => {
  beforeEach(() => {
    resetBoardState();
    server.use(onboarded());
  });

  it('renders offers with eligibility, blocked reasons and type filters', async () => {
    await renderBoard();

    // Each offer says what the job is (title), where it goes, and what it needs.
    expect((await screen.findAllByText('Corporate Delivery')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Deliver sealed cargo to the destination.').length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText('Flight time').length).toBeGreaterThan(0);
    expect(screen.getAllByText('You need:').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Eligible')).toHaveLength(3);
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Needs a mining system')).toBeInTheDocument();
    expect(screen.getByText('Mobility too low')).toBeInTheDocument();
    expect(screen.getByText('On hold')).toBeInTheDocument();
    expect(screen.getAllByText('1,200 ¢').length).toBeGreaterThan(0);

    expect(document.querySelectorAll('.mcard')).toHaveLength(4);
    fireEvent.click(screen.getByRole('tab', { name: 'Mining' }));
    expect(document.querySelectorAll('.mcard')).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'All missions' }));
    expect(document.querySelectorAll('.mcard')).toHaveLength(4);
  });

  it('accepts an eligible offer and moves on to the transit screen', async () => {
    await renderBoard();

    const acceptButtons = await screen.findAllByRole('button', { name: 'Accept' });
    expect(acceptButtons).toHaveLength(4);
    fireEvent.click(acceptButtons[0] as Element);

    // Embedded: accepting switches the host back to its own Ship tab (no route change) —
    // the just-accepted mission's travel summary appears there.
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Ship' })).toHaveAttribute('aria-selected', 'true'),
    );
  });

  it('holds an offer and releases it again', async () => {
    await renderBoard();

    const holdButtons = await screen.findAllByRole('button', { name: 'Hold' });
    expect(holdButtons).toHaveLength(3);
    fireEvent.click(holdButtons[1] as Element);

    await waitFor(() => expect(screen.getAllByText('On hold')).toHaveLength(2));
    const releaseButtons = await screen.findAllByRole('button', { name: 'Release' });
    fireEvent.click(releaseButtons[0] as Element);

    await waitFor(() => expect(screen.getAllByText('On hold')).toHaveLength(1));
    expect(screen.getAllByRole('button', { name: 'Hold' })).toHaveLength(3);
  });

  it('reads the board location from the query string', async () => {
    await renderBoard('?location=gate');

    expect(
      await screen.findByRole('heading', { name: 'Portão Kessler', level: 2 }),
    ).toBeInTheDocument();
    expect(document.querySelectorAll('.mcard')).toHaveLength(4);
  });

  it("labels the player's private start-safe mission (D43) and no shared offer", async () => {
    server.use(
      http.get('/v1/locations/:id/missions', () =>
        HttpResponse.json(
          [
            {
              id: 'starter-1',
              templateId: 'delivery_luna',
              type: 'DELIVERY',
              factionId: 'luna',
              originId: 'ceres',
              destinationId: 'tycho',
              legs: [],
              cargo: {},
              reward: 300,
              expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
              status: 'AVAILABLE',
              playerId: null,
              privatePlayerId: 'player-1',
              shipId: null,
              acceptedAt: null,
              arrivalAt: null,
              deadlineAt: null,
              seed: 'starter|player-1|ceres|0',
              version: 0,
              rewardEstimate: 300,
              eligibility: { eligible: true, reasons: [] },
              info: {
                title: { en: 'First Steps', 'pt-BR': 'Primeiros Passos' },
                description: { en: 'An easy first run.', 'pt-BR': 'Uma primeira viagem fácil.' },
                legCount: 1,
                totalDistance: 400,
                peakDanger: 1,
                peakZone: 0,
                estimate: { durationSeconds: 120, fuelNeeded: 4 },
                material: null,
              },
            },
          ],
          { status: 200 },
        ),
      ),
    );
    await renderBoard();
    expect(await screen.findByTestId('starter-badge')).toHaveTextContent('Starter mission');
    expect(screen.getAllByTestId('starter-badge')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
  });
});
