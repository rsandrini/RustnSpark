import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
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

describe('report (S10.8)', () => {
  beforeEach(() => {
    server.use(onboarded());
  });

  it('shows the summary view with the outcome verdict and back links', async () => {
    renderWithRouter(routes, { initialEntries: ['/report/m-1'] });

    expect(await screen.findByRole('heading', { name: 'Mission report' })).toBeInTheDocument();
    expect(screen.getByText('Mission accomplished')).toBeInTheDocument();
    expect(screen.getByText('Mission accomplished — balance 1400 ¢')).toBeInTheDocument();
    expect(screen.getByText('Payment +1400 ¢')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Back to the map' })).toHaveAttribute('href', '/map');
    expect(screen.getByRole('link', { name: 'Back to the board' })).toHaveAttribute(
      'href',
      '/board',
    );
    expect(screen.getByRole('tab', { name: 'Summary' })).toHaveAttribute('aria-selected', 'true');
  });

  it('renders the narrative chapters and opens the event popup', async () => {
    renderWithRouter(routes, { initialEntries: ['/report/m-1'] });

    fireEvent.click(await screen.findByRole('tab', { name: 'Narrative' }));

    expect(await screen.findByText('Leg 1 — completed')).toBeInTheDocument();
    expect(screen.getByText('Departed Porto Ceres on schedule.')).toBeInTheDocument();
    expect(screen.getByText('A raider hit the hull in transit.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Event details' }));
    const popup = await screen.findByRole('dialog', { name: 'Event details' });
    expect(popup.textContent).toContain('Shield absorbed');
    expect(popup.textContent).toContain('Armor absorbed');
    expect(popup.textContent).toContain('Hull damage');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Event details' })).not.toBeInTheDocument(),
    );
  });

  it('renders the raw log view', async () => {
    renderWithRouter(routes, { initialEntries: ['/report/m-1'] });

    fireEvent.click(await screen.findByRole('tab', { name: 'Log' }));

    expect(await screen.findByText('[00:42] combat pirate')).toBeInTheDocument();
    expect(screen.getByText('[00:00] depart ceres')).toBeInTheDocument();
  });

  it('shows a placeholder when the mission has no report yet', async () => {
    server.use(
      http.get('/v1/reports', () => HttpResponse.json({ items: [] }, { status: 200 })),
      http.get('/v1/reports/:missionId', () =>
        HttpResponse.json({ statusCode: 404, message: 'not found' }, { status: 404 }),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/report/missing'] });

    expect(await screen.findByText('No report for this mission yet.')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('labels the report from its own response (works for any mission, not just the first page of runs)', async () => {
    server.use(
      http.get('/v1/reports/:missionId', () =>
        HttpResponse.json(
          {
            locale: 'en',
            outcome: 'adrift',
            view: 'summary',
            lines: [{ text: 'Ship adrift', segments: [{ t: 'text', value: 'Ship adrift' }] }],
          },
          { status: 200 },
        ),
      ),
      http.get('/v1/reports', () => HttpResponse.json({ items: [] }, { status: 200 })),
    );
    renderWithRouter(routes, { initialEntries: ['/report/m-99'] });
    expect(await screen.findByText('Ship adrift', { selector: '.verdict' })).toBeInTheDocument();
  });

  it('keeps the tab bar on screen while the next view loads', async () => {
    server.use(
      http.get('/v1/reports/:missionId', async ({ request }) => {
        const view = new URL(request.url).searchParams.get('view') ?? 'summary';
        if (view === 'narrative') await delay(200);
        return HttpResponse.json(
          {
            locale: 'en',
            outcome: 'success',
            view: view === 'narrative' ? 'narrative' : 'summary',
            ...(view === 'narrative'
              ? { chapters: [] }
              : {
                  lines: [
                    { text: 'Summary line', segments: [{ t: 'text', value: 'Summary line' }] },
                  ],
                }),
          },
          { status: 200 },
        );
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/report/m-1'] });
    await screen.findByText('Summary line');

    fireEvent.click(screen.getByRole('tab', { name: 'Narrative' }));
    // Mid-load: still the previous view, still the tabs — no full-page "Loading".
    expect(screen.getByRole('tab', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByText('Summary line')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Narrative' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
  });

  it('opens a detail popup for a loot reference', async () => {
    server.use(
      http.get('/v1/reports/:missionId', () =>
        HttpResponse.json(
          {
            locale: 'en',
            outcome: 'success',
            view: 'summary',
            lines: [
              {
                text: 'Hauled Iron',
                segments: [
                  { t: 'text', value: 'Hauled ' },
                  { t: 'ref', kind: 'loot', id: 'iron', value: 'Iron' },
                ],
              },
            ],
          },
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/report/m-1'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Iron' }));
    const popup = await screen.findByRole('dialog', { name: 'Iron' });
    expect(popup).toHaveTextContent('Item');
    // Real detail from the catalog: description and rarity, not just the name.
    expect(await within(popup).findByText('Raw ore.')).toBeInTheDocument();
    expect(popup).toHaveTextContent('Rarity');
  });

  it('still opens a popup for a reference that has left the catalog (404)', async () => {
    server.use(
      http.get('/v1/reports/:missionId', () =>
        HttpResponse.json(
          {
            locale: 'en',
            outcome: 'success',
            view: 'summary',
            lines: [
              {
                text: 'Lost a Ghost Part',
                segments: [
                  { t: 'text', value: 'Lost a ' },
                  { t: 'ref', kind: 'part', id: 'retired_part', value: 'Ghost Part' },
                ],
              },
            ],
          },
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/report/m-1'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Ghost Part' }));
    const popup = await screen.findByRole('dialog', { name: 'Ghost Part' });
    expect(popup).toHaveTextContent('Part');
    // The lookup 404s and the popup settles on what the report itself carried.
    await waitFor(() => expect(popup).not.toHaveTextContent('Loading'));
  });
});
