import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { addWreck, economyState, resetEconomyState } from '../../test/msw/handlers';
import { queryByRoleSafe } from '../../test/queries';
import { routes } from '../../app/router';

const onboarded = () =>
  http.get('/v1/players/me', () =>
    HttpResponse.json(
      {
        id: 'player-1',
        name: 'Test Pilot',
        credits: economyState.wallet,
        role: 'PLAYER',
        locale: 'en',
        factionId: 'luna',
      },
      { status: 200 },
    ),
  );

function rowButton(label: string | RegExp): Element {
  const row = screen.getByText(label).closest('.pcard');
  if (row === null) throw new Error('row not found');
  const button = row.querySelector('button:not(.info-btn)');
  if (button === null) throw new Error('button not found');
  return button;
}

describe('port (S10.9)', () => {
  beforeEach(() => {
    resetEconomyState();
    server.use(onboarded());
  });

  it('buys a listing behind the confirmation popup and updates the wallet', async () => {
    renderWithRouter(routes, { initialEntries: ['/port'] });

    expect(await screen.findByRole('heading', { name: 'Port', exact: true })).toBeInTheDocument();
    expect(screen.getByTestId('wallet')).toHaveTextContent('4,820 ¢');
    expect(screen.getByText('Plated Hull')).toBeInTheDocument();

    fireEvent.click(rowButton('Plated Hull'));
    const popup = await screen.findByRole('dialog', {
      name: 'Buy Plated Hull for 300 ¢?',
    });
    expect(popup).toHaveTextContent('Balance after: 4,520 ¢');
    fireEvent.click(within(popup).getByRole('button', { name: 'Buy' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Bought Plated Hull for 300 ¢.');
    await waitFor(() => expect(screen.getByTestId('wallet')).toHaveTextContent('4,520 ¢'));
  });

  it('disables spending on a negative balance while scavenging stays open', async () => {
    server.use(
      http.get('/v1/players/me', () =>
        HttpResponse.json(
          {
            id: 'player-1',
            name: 'Test Pilot',
            credits: -120,
            role: 'PLAYER',
            locale: 'en',
            factionId: 'luna',
          },
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/port'] });

    expect(await screen.findByTestId('wallet')).toHaveTextContent('-120 ¢');
    expect(screen.getByText(/Negative balance/i)).toBeInTheDocument();
    expect(rowButton('Plated Hull')).toBeDisabled();

    fireEvent.click(screen.getByRole('tab', { name: 'Refuel' }));
    expect(screen.getByRole('button', { name: /^Buy \d+/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('tab', { name: 'Scavenging' }));
    expect(screen.getByRole('button', { name: /Send the ship scavenging/i })).toBeEnabled();
  });

  it('sells all mined materials after the quote popup', async () => {
    renderWithRouter(routes, { initialEntries: ['/port'] });

    fireEvent.click(await screen.findByRole('tab', { name: 'Your goods' }));
    fireEvent.click(rowButton(/Iron/));
    const popup = await screen.findByRole('dialog', { name: 'Sell Iron for 24 ¢?' });
    expect(popup).toHaveTextContent('Balance after: 4,844 ¢');
    fireEvent.click(within(popup).getByRole('button', { name: 'Sell' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Sold Iron for 24 ¢.');
    await waitFor(() => expect(screen.getByTestId('wallet')).toHaveTextContent('4,844 ¢'));
  });

  it('repair starts at the current state, prices each part and the total, then charges once', async () => {
    renderWithRouter(routes, { initialEntries: ['/port'] });

    fireEvent.click(await screen.findByRole('tab', { name: /^Repair/ }));
    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(6);
    // Nothing is selected by default: every slider sits at the part's current condition.
    for (const slider of sliders) {
      expect((slider as HTMLInputElement).value).toBe((slider as HTMLInputElement).min);
    }
    const summary = screen.getByTestId('repair-summary');
    expect(summary).toHaveTextContent('Nothing selected yet');
    expect(within(summary).getByRole('button', { name: 'Start repair' })).toBeDisabled();

    // One click sets everything to 100 %: each row shows its own price and time, then a total.
    fireEvent.click(within(summary).getByRole('button', { name: 'Set all to 100%' }));
    await waitFor(() => expect(screen.getByTestId('repair-total')).toHaveTextContent('1,188 ¢'));
    expect(
      screen.getAllByTestId('repair-line').every((line) => /¢/.test(line.textContent ?? '')),
    ).toBe(true);

    // ...and "Back to current" undoes it without repairing anything.
    fireEvent.click(within(summary).getByRole('button', { name: 'Back to current' }));
    expect(screen.getByTestId('repair-summary')).toHaveTextContent('Nothing selected yet');
    fireEvent.click(within(summary).getByRole('button', { name: 'Set all to 100%' }));
    await waitFor(() => expect(screen.getByTestId('repair-total')).toHaveTextContent('1,188 ¢'));

    fireEvent.click(within(summary).getByRole('button', { name: 'Start repair' }));
    const popup = await screen.findByRole('dialog', { name: 'Repair for 1188 ¢?' });
    expect(economyState.wallet).toBe(4820);
    fireEvent.click(within(popup).getByRole('button', { name: 'Start repair' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Repair started for 1188 ¢');
    await waitFor(() => expect(screen.getByTestId('wallet')).toHaveTextContent('3,632 ¢'));
  });

  it('fills the tank and scavenges the field', async () => {
    renderWithRouter(routes, { initialEntries: ['/port'] });

    fireEvent.click(await screen.findByRole('tab', { name: 'Refuel' }));
    expect(screen.getByText('Fuel 25 / 40')).toBeInTheDocument();
    // The slider defaults to filling the tank; the price shown is the server's quote of that amount.
    await waitFor(() => expect(screen.getByTestId('refuel-cost')).toHaveTextContent('45 ¢'));
    fireEvent.click(screen.getByRole('button', { name: 'Buy 15' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Filled 15 units for 45 ¢.');
    await waitFor(() => expect(screen.getByTestId('wallet')).toHaveTextContent('4,775 ¢'));

    fireEvent.click(screen.getByRole('tab', { name: 'Scavenging' }));
    // The tab explains itself: time, risk, what you find, and where it works.
    const scav = await screen.findByTestId('scavenging');
    expect(await within(scav).findByText(/about 5 minutes/)).toBeInTheDocument();
    expect(within(scav).getByText(/zone 1/)).toBeInTheDocument();
    expect(within(scav).getByText(/Everything you find is USED/)).toBeInTheDocument();
    expect(within(scav).getByText(/only works where your ship is docked/)).toBeInTheDocument();

    // Starting the job sends the ship out and the pilot to the Transit screen.
    fireEvent.click(screen.getByRole('button', { name: 'Send the ship scavenging' }));
    expect(await screen.findByRole('heading', { name: 'In transit' })).toBeInTheDocument();
  });

  it('opens the market of the port where the ship is docked, not a hard-coded one', async () => {
    const requested: string[] = [];
    server.use(
      http.get('/v1/ships', () =>
        HttpResponse.json(
          [
            {
              id: 'ship-1',
              ownerPlayerId: 'player-1',
              name: 'sun starter',
              fuel: 25,
              status: 'IN_PORT',
              currentLocationId: 'hedus',
              stance: 'NEUTRAL',
              layout: [],
              sheet: { fuelCap: 40 },
              shipClass: 'MULTIROLE',
              activity: { kind: 'idle', until: null, missionId: null },
            },
          ],
          { status: 200 },
        ),
      ),
      http.get('/v1/locations/:id/market', ({ params }) => {
        requested.push(String(params.id));
        return HttpResponse.json(
          { locationId: String(params.id), listings: [], sellOffers: [], sellMinCondition: 15 },
          { status: 200 },
        );
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/port'] });
    expect(await screen.findByRole('heading', { name: 'Port', exact: true })).toBeInTheDocument();
    expect(requested).toContain('hedus');
    expect(requested).not.toContain('ceres');
  });

  it('sends an Idempotency-Key on every spending POST, reusing it for a retry of the same action', async () => {
    const keys: string[] = [];
    let attempts = 0;
    server.use(
      http.post('/v1/market/buy', ({ request }) => {
        keys.push(request.headers.get('idempotency-key') ?? '');
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json(
            { statusCode: 409, message: { error: 'INSUFFICIENT_FUNDS' } },
            { status: 409 },
          );
        }
        return HttpResponse.json(
          { partInstanceId: 'p-9', partType: 'hull', condition: 100, price: 300, credits: 4520 },
          { status: 200 },
        );
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/port'] });

    await screen.findByText('Plated Hull');
    fireEvent.click(rowButton('Plated Hull'));
    let popup = await screen.findByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: 'Buy' }));
    // A translated message, not the generic one.
    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough credits.');

    popup = screen.getByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: 'Buy' }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).not.toBe('');
    expect(keys[1]).toBe(keys[0]);
  });

  it('refuel, sell and repair are refused by the (strict) mock without a key — and the UI sends one', async () => {
    renderWithRouter(routes, { initialEntries: ['/port'] });
    fireEvent.click(await screen.findByRole('tab', { name: 'Refuel' }));
    await waitFor(() => expect(screen.getByTestId('refuel-cost')).toHaveTextContent('45 ¢'));
    fireEvent.click(screen.getByRole('button', { name: 'Buy 15' }));
    // The strict mock answers 400 IDEMPOTENCY_KEY_REQUIRED if the header is missing.
    expect(await screen.findByRole('status')).toHaveTextContent('Filled 15 units');
    expect(queryByRoleSafe('alert')).toBeNull();
  });

  it('a stale buy price updates the popup with the server price instead of failing silently', async () => {
    server.use(
      http.post('/v1/market/buy', () =>
        HttpResponse.json(
          { statusCode: 409, message: { error: 'PRICE_CHANGED', actual: 320 } },
          { status: 409 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/port'] });
    await screen.findByText('Plated Hull');
    fireEvent.click(rowButton('Plated Hull'));
    const popup = await screen.findByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: 'Buy' }));
    expect(await screen.findByRole('dialog', { name: /320 ¢/ })).toHaveTextContent(
      'The price changed to 320 ¢ — confirm again.',
    );
  });

  it('sells an inventory part at the port quote on the first click', async () => {
    renderWithRouter(routes, { initialEntries: ['/port'] });
    await screen.findByText('Plated Hull');
    fireEvent.click(rowButton('Plated Hull'));
    let popup = await screen.findByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: 'Buy' }));
    await screen.findByRole('status');

    fireEvent.click(screen.getByRole('tab', { name: 'Your goods' }));
    const sell = await screen.findAllByRole('button', { name: 'Sell' });
    fireEvent.click(sell[0]!);
    popup = await screen.findByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: 'Sell' }));
    // No PRICE_CHANGED round trip: the sale goes through.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Sold /));
    expect(queryByRoleSafe('alert')).toBeNull();
  });

  it('refreshes the wallet from the profile, never by rotating the session', async () => {
    let sessionRefreshes = 0;
    server.use(
      http.post('/v1/auth/refresh', () => {
        sessionRefreshes += 1;
        return HttpResponse.json({ accessToken: 'token-x' }, { status: 200 });
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/port'] });
    await screen.findByTestId('wallet');
    const before = sessionRefreshes;
    await screen.findByText('Plated Hull');
    fireEvent.click(rowButton('Plated Hull'));
    const popup = await screen.findByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: 'Buy' }));
    await waitFor(() => expect(screen.getByTestId('wallet')).toHaveTextContent('4,520 ¢'));
    expect(sessionRefreshes).toBe(before);
  });

  it('refuel: the slider picks how much to buy and the price follows the amount', async () => {
    renderWithRouter(routes, { initialEntries: ['/port'] });
    fireEvent.click(await screen.findByRole('tab', { name: 'Refuel' }));
    const slider = await screen.findByLabelText('How much fuel to buy');
    fireEvent.change(slider, { target: { value: '5' } });
    await waitFor(() => expect(screen.getByTestId('refuel-cost')).toHaveTextContent('15 ¢'));
    fireEvent.click(screen.getByRole('button', { name: 'Buy 5' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Filled 5 units for 15 ¢.');
  });

  it('a too-damaged loose part cannot be sold; discard asks first, then destroys it', async () => {
    addWreck();
    renderWithRouter(routes, { initialEntries: ['/port'] });
    fireEvent.click(await screen.findByRole('tab', { name: 'Your goods' }));
    const note = await screen.findByTestId('discard-note');
    expect(note).toHaveTextContent('under 15% condition');
    expect(screen.getByText('Too damaged to sell')).toBeInTheDocument();

    fireEvent.click(within(note).getByRole('button', { name: /Discard 1/ }));
    const popup = await screen.findByRole('dialog', { name: 'Destroy 1 damaged part(s)?' });
    fireEvent.click(within(popup).getByRole('button', { name: 'Destroy them' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Discarded 1 damaged part(s).');
    await waitFor(() => expect(screen.queryByTestId('discard-note')).toBeNull());
  });
});
