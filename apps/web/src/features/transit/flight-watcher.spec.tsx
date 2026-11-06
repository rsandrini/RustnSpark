import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { FeedbackProvider } from '../../ui/feedback';
import { setUnsavedLayout } from '../hangar/unsaved-layout';
import { FlightWatcher, watchFlight } from './flight-watcher';

// A flight that ends before the page's first look at the active list (an empty list before and after)
// must still take the pilot to its report.
const SHIP = 'ship';
const REPORT = 'the report';

describe('FlightWatcher', () => {
  it('goes to the report of a flight dispatched while the active list stays empty', async () => {
    let reports = 0;
    server.use(
      http.get('/v1/missions/active', () => HttpResponse.json([])),
      http.get('/v1/reports', () => {
        reports += 1;
        // the first answer is the report list from before the flight; the flight's own report shows up later
        return HttpResponse.json({
          items:
            reports < 2
              ? []
              : [
                  {
                    missionId: 'm-fast',
                    outcome: 'success',
                    credits: 1,
                    legs: 1,
                    createdAt: new Date().toISOString(),
                    hadCombat: false,
                  },
                ],
        });
      }),
    );
    renderWithRouter(
      [
        {
          path: '/',
          element: (
            <>
              <FlightWatcher />
              <p>{SHIP}</p>
            </>
          ),
        },
        { path: '/report/:id', element: <p>{REPORT}</p> },
      ],
      { initialEntries: ['/'] },
    );
    await waitFor(() => expect(reports).toBeGreaterThan(0));
    watchFlight('m-fast');
    expect(await screen.findByText(REPORT, {}, { timeout: 8000 })).toBeInTheDocument();
  }, 12000);

  it('stays on the screen while the hangar has unsaved layout changes, and says the report is ready', async () => {
    server.use(
      http.get('/v1/missions/active', () => HttpResponse.json([])),
      http.get('/v1/reports', () =>
        HttpResponse.json({
          items: [
            {
              missionId: 'm-held',
              outcome: 'success',
              credits: 1,
              legs: 1,
              createdAt: new Date().toISOString(),
              hadCombat: false,
            },
          ],
        }),
      ),
    );
    setUnsavedLayout(true);
    try {
      renderWithRouter(
        [
          {
            path: '/',
            element: (
              <FeedbackProvider>
                <FlightWatcher />
                <p>{SHIP}</p>
              </FeedbackProvider>
            ),
          },
          { path: '/report/:id', element: <p>{REPORT}</p> },
        ],
        { initialEntries: ['/'] },
      );
      watchFlight('m-held');
      const next = await screen.findByRole('button', { name: 'Report' }, { timeout: 8000 });
      expect(screen.getByRole('status')).toHaveTextContent(
        'Your flight is over. Save your layout, then read the report.',
      );
      await userEvent.click(next);
      expect(await screen.findByText(REPORT)).toBeInTheDocument();
    } finally {
      setUnsavedLayout(false);
    }
  }, 12000);
});
