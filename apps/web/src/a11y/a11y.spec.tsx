import { describe, it, expect, beforeEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../test/utils';
import { server } from '../test/msw/server';
import { resetEconomyState } from '../test/msw/handlers';
import { routes } from '../app/router';

/**
 * Accessibility pass (T1.4): every player-facing screen is rendered with the real router and
 * mock API, and axe-core must find no violations. jsdom cannot compute layout, so colour
 * contrast and viewport rules are covered by the browser smoke (T1.3), not here.
 */
const onboarded = () =>
  http.get('/v1/players/me', () =>
    HttpResponse.json(
      {
        id: 'player-1',
        name: 'Test Pilot',
        credits: 4820,
        role: 'PLAYER',
        locale: 'en',
        factionId: 'luna',
      },
      { status: 200 },
    ),
  );

const SCREENS: ReadonlyArray<{ path: string; ready: RegExp | string; name: string }> = [
  { path: '/map', ready: 'Sector map', name: 'map' },
  { path: '/board', ready: 'Mission board', name: 'board' },
  { path: '/hangar', ready: 'My Ship', name: 'hangar' },
  { path: '/transit', ready: 'In transit', name: 'transit' },
  { path: '/port', ready: 'Port', name: 'port' },
  { path: '/profile', ready: /profile|pilot/i, name: 'profile' },
  { path: '/report/m-1', ready: 'Mission report', name: 'report' },
];

describe('accessibility (axe)', () => {
  beforeEach(() => {
    resetEconomyState();
    server.use(onboarded());
  });

  it.each(SCREENS)('$name has no axe violations', async ({ path, ready }) => {
    const { container } = renderWithRouter(routes, { initialEntries: [path] });
    await screen.findByRole('heading', { name: ready });
    // Let the screen's queries settle inside act() before auditing the final DOM.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const results = await axe(container, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(
      results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`),
    ).toEqual([]);
  });

  it('login and register have no axe violations', async () => {
    for (const path of ['/login', '/register']) {
      server.use(
        http.post('/v1/auth/refresh', () =>
          HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
        ),
      );
      const { container, unmount } = renderWithRouter(routes, { initialEntries: [path] });
      await screen.findByRole('heading');
      const results = await axe(container, {
        rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
      });
      expect(results.violations.map((v) => v.id)).toEqual([]);
      unmount();
    }
  });
});
