import { beforeEach, describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { routes } from '../../app/router';
import i18n from '../../i18n';
import { resetActiveState } from '../../test/msw/handlers';

const onboarded = () =>
  http.get('/v1/players/me', () =>
    HttpResponse.json({
      id: 'player-1',
      name: 'Test Pilot',
      credits: 0,
      role: 'PLAYER',
      locale: 'en',
      factionId: 'luna',
    }),
  );

async function openSheet(place = 'tycho') {
  server.use(onboarded());
  renderWithRouter(routes, { initialEntries: [`/map?place=${place}`] });
  return screen.findByTestId('place-sheet');
}

describe('PlaceSheet', () => {
  beforeEach(async () => {
    resetActiveState();
    await i18n.changeLanguage('en');
  });

  it('opens with the name, faction, contracts count and the quote time and fuel', async () => {
    const sheet = await openSheet();
    expect(sheet).toHaveAccessibleName('Estaleiro Tycho');
    expect(within(sheet).getByText(/Luna Authority/)).toBeInTheDocument();
    expect(within(sheet).getByTestId('sheet-contracts')).toHaveAttribute(
      'href',
      '/missions?location=tycho',
    );
    expect(await within(sheet).findByText('2m 30s')).toBeInTheDocument();
    expect(within(sheet).getByTestId('sheet-fuel')).toHaveTextContent('12 fuel');
    expect(within(sheet).getByRole('button', { name: 'Plan trip' })).toBeEnabled();
    expect(within(sheet).getByRole('img', { name: 'Low risk' })).toBeInTheDocument();
  });

  it('shows a red chip leading to refuel and a disabled Plan trip with the reason when fuel is short', async () => {
    server.use(
      http.get('/v1/travel/quote', () =>
        HttpResponse.json({
          originId: 'ceres',
          destinationId: 'tycho',
          legs: [
            { routeId: 'r', fromId: 'ceres', toId: 'tycho', distance: 400, danger: 5, zone: 1 },
          ],
          totalDistance: 400,
          durationSeconds: 150,
          fuelNeeded: 40,
          fuelHave: 25,
          fuelCap: 60,
          peakDanger: 5,
          blockers: ['NOT_ENOUGH_FUEL'],
          canDepart: false,
        }),
      ),
    );
    const sheet = await openSheet();
    const chip = await within(sheet).findByTestId('sheet-fuel-chip');
    expect(chip).toHaveAttribute('href', '/port?tab=refuel');
    expect(within(sheet).getByRole('button', { name: 'Plan trip' })).toBeDisabled();
    expect(within(sheet).getByTestId('sheet-reason')).toHaveTextContent(/Not enough fuel/);
  });

  it('posts the travel and lands on the ship screen', async () => {
    let posted: unknown = null;
    server.use(
      http.post('/v1/travel', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({
          missionId: 'travel-1',
          arrivalAt: new Date(Date.now() + 150_000).toISOString(),
          serverTime: new Date().toISOString(),
        });
      }),
    );
    const sheet = await openSheet();
    await within(sheet).findByText('2m 30s');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Plan trip' }));
    await screen.findByRole('heading', { name: 'My Ship' });
    expect(posted).toEqual({ destinationId: 'tycho' });
  });

  it('reveals the full details behind the Details toggle', async () => {
    const sheet = await openSheet();
    expect(within(sheet).queryByTestId('travel')).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Details' }));
    expect(await within(sheet).findByTestId('travel')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Hide details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('draws the planned route on the chart once the quote is in', async () => {
    await openSheet();
    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid="trip-preview"]')).toHaveLength(1),
    );
  });
});
