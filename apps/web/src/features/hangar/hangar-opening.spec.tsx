import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { routes } from '../../app/router';

// The ship screen as the tutorial shows it: the real screen with the opening mode on.
vi.mock('../prologue/prologue-mode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../prologue/prologue-mode')>();
  const idle = actual.usePrologueMode;
  return { ...actual, usePrologueMode: () => ({ ...idle(), active: true }) };
});

describe('HangarPage in the tutorial', () => {
  it('has no Ship/Hold menu: only the ship, even with Hold remembered', async () => {
    window.localStorage.setItem('rs.shipTab', 'hold');
    server.use(
      http.get('/v1/players/me', () =>
        HttpResponse.json({
          id: 'player-1',
          name: 'Test Pilot',
          credits: 0,
          role: 'PLAYER',
          locale: 'en',
          factionId: 'luna',
        }),
      ),
    );
    const { container } = renderWithRouter(routes, { initialEntries: ['/hangar'] });
    await vi.waitFor(() => expect(container.querySelector('.hangar-layout')).not.toBeNull());

    expect(screen.queryByTestId('ship-tab-ship')).toBeNull();
    expect(screen.queryByTestId('ship-tab-hold')).toBeNull();
    expect(screen.queryByTestId('hold-panel')).toBeNull();
    expect(screen.queryByTestId('hold-chip')).toBeNull();
    expect(container.querySelector('.hangar-layout')).not.toHaveAttribute('hidden');
    window.localStorage.removeItem('rs.shipTab');
  });
});
