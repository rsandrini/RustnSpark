import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../test/utils';
import { server } from '../test/msw/server';
import {
  economyState,
  resetBoardState,
  resetEconomyState,
  resetActiveState,
  setShipActivity,
  setWallet,
} from '../test/msw/handlers';
import { routes } from '../app/router';
import { MemoryRouter } from 'react-router';
import { FeedbackProvider, useFeedback } from './feedback';

const haptics = vi.hoisted(() => ({ haptic: vi.fn() }));
vi.mock('./haptics', async (importOriginal) => {
  const original = await importOriginal<typeof import('./haptics')>();
  return { ...original, haptic: haptics.haptic };
});

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

const ACT = 'act';
const FAIL = { statusCode: 500, message: 'boom' };

beforeEach(() => {
  haptics.haptic.mockClear();
  resetEconomyState();
  setShipActivity(null);
  resetBoardState();
  resetActiveState();
  server.use(onboarded());
});

describe('haptic call sites', () => {
  it('a mission that cannot be accepted buzzes one error and no success', async () => {
    server.use(
      http.post('/v1/missions/:id/accept', () => HttpResponse.json(FAIL, { status: 500 })),
    );
    renderWithRouter(routes, { initialEntries: ['/hangar/board'] });
    await screen.findByRole('tab', { name: /^All missions/ });
    fireEvent.click(screen.getByRole('button', { name: 'Only eligible' }));
    const buttons = await screen.findAllByRole('button', { name: /Accept/ });
    fireEvent.click(buttons.find((button) => !button.hasAttribute('disabled')) as Element);
    await waitFor(() => expect(haptics.haptic).toHaveBeenCalledWith('error'));
    expect(haptics.haptic).toHaveBeenCalledTimes(1);
    expect(haptics.haptic).not.toHaveBeenCalledWith('success');
  });

  it('a market buy that fails buzzes one error', async () => {
    window.localStorage.setItem('rs.storeView', 'list');
    setWallet(4820);
    server.use(http.post('/v1/market/buy', () => HttpResponse.json(FAIL, { status: 500 })));
    renderWithRouter(routes, { initialEntries: ['/hangar/port'] });
    await screen.findByRole('tab', { name: 'Market' });
    const row = (await screen.findByText('Plated Hull')).closest('[data-testid="part-row"]')!;
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Buy' }));
    const popup = await screen.findByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: 'Buy' }));
    await waitFor(() => expect(haptics.haptic).toHaveBeenCalledWith('error'));
    expect(haptics.haptic).toHaveBeenCalledTimes(1);
  });

  it('a port trade that fails (selling goods) buzzes one error', async () => {
    server.use(
      http.post('/v1/market/sell-material', () => HttpResponse.json(FAIL, { status: 500 })),
    );
    renderWithRouter(routes, { initialEntries: ['/hangar/port'] });
    await screen.findByRole('tab', { name: 'Market' });
    fireEvent.click(screen.getByRole('tab', { name: 'Your goods' }));
    const row = (await screen.findByText(/Iron/)).closest('.pcard')!;
    fireEvent.click(row.querySelector('button:not(.info-btn):not(.link)') as Element);
    const popup = await screen.findByRole('dialog');
    fireEvent.click(within(popup).getByRole('button', { name: 'Sell' }));
    await waitFor(() => expect(haptics.haptic).toHaveBeenCalledWith('error'));
    expect(haptics.haptic).toHaveBeenCalledTimes(1);
  });
});

describe('the toast respects the haptics opt-out', () => {
  function Trigger() {
    const { notify } = useFeedback();
    return (
      <button type="button" onClick={() => notify('Done.')}>
        {ACT}
      </button>
    );
  }
  afterEach(() => {
    delete (navigator as { vibrate?: unknown }).vibrate;
    localStorage.removeItem('rs.haptics');
    window.dispatchEvent(new StorageEvent('storage', { key: 'rs.haptics' }));
    vi.restoreAllMocks();
  });

  it('buzzes nothing when the setting is off, and does when it is on', async () => {
    const actual = await vi.importActual<typeof import('./haptics')>('./haptics');
    haptics.haptic.mockImplementation(actual.haptic);
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    localStorage.setItem('rs.haptics', 'off');
    window.dispatchEvent(new StorageEvent('storage', { key: 'rs.haptics' }));
    render(
      <MemoryRouter>
        <FeedbackProvider>
          <Trigger />
        </FeedbackProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText(ACT));
    expect(vibrate).not.toHaveBeenCalled();
    localStorage.removeItem('rs.haptics');
    fireEvent.click(screen.getByText(ACT));
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});
