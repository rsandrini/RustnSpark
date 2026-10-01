import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { routes } from '../../app/router';

const STATS = {
  credits: 0,
  balanceAfter: null,
  legs: 1,
  distance: 0,
  fights: { won: 0, lost: 0, escaped: 0, drawn: 0, pvp: 0 },
  damage: { shield: 0, armor: 0, hull: 0 },
  hasShield: true,
  partsDamage: [],
  partFailures: 0,
  fuelLost: 0,
  found: [],
  pirates: { stolenParts: 0, motive: null },
  loot: [],
};

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
    // The debrief leads: verdict, what the mission was, what it paid and what it cost.
    const debrief = await screen.findByTestId('debrief');
    expect(debrief).toHaveTextContent('Mission accomplished');
    expect(debrief).toHaveTextContent('Corporate Delivery');
    expect(debrief).toHaveTextContent('+1,400 ¢');
    expect(debrief).toHaveTextContent('Shield 4 · armor 3 · hull 2');
    expect(debrief).toHaveTextContent('6 × Iron');
    fireEvent.click(await screen.findByRole('tab', { name: 'Summary' }));
    expect(await screen.findByText('Mission accomplished — balance 1400 ¢')).toBeInTheDocument();
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

    expect(await screen.findByText('Leg 1 — completed')).toBeInTheDocument();
    expect(screen.getByText('Departed Porto Ceres on schedule.')).toBeInTheDocument();
    expect(screen.getByText('A raider hit the hull in transit.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Event details' }));
    const popup = await screen.findByRole('dialog', { name: 'Event details' });
    expect(popup.textContent).toContain('Shield absorbed');
    expect(popup.textContent).toContain('Armor absorbed');
    expect(popup.textContent).toContain('Hull damage');
    // Owner request: this popup specifically needs more room than the default confirm-dialog
    // width — a scoped override, not a change to every popup in the app.
    expect(popup).toHaveClass('combat-log-modal');

    // Round-by-round combat log (round-4 owner request): every attack, in order, not just
    // the fight's totals.
    const table = within(popup).getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4); // header + 3 attacks
    const hitRow = rows[1]!;
    const missRow = rows[2]!;
    expect(hitRow).toHaveTextContent('1');
    expect(hitRow).toHaveTextContent('Enemy');
    // Owner follow-up: the hit check is actually roll + pdf + bonus >= dc, not roll >= dc — show
    // the real breakdown (14 + firepower 3 + first-strike bonus 2 = 19) instead of a bare
    // "14 / 10" that can look inconsistent with a Hit result.
    expect(hitRow).toHaveTextContent('14 + 3 + 2 = 19 / 10');
    expect(hitRow).toHaveTextContent('Hit');
    // Owner request: a colored pill for the result and a consistent color per damage type,
    // not flat text for all seven columns.
    expect(within(hitRow).getByText('Hit')).toHaveClass('pill', 'pill-hit');
    expect(hitRow.querySelector('.dmg-shield')).toHaveTextContent('3');
    expect(hitRow.querySelector('.dmg-armor')).toHaveTextContent('1');
    expect(hitRow.querySelector('.dmg-hull')).toHaveTextContent('1');
    expect(missRow).toHaveTextContent('You');
    expect(missRow).toHaveTextContent('Miss');
    expect(within(missRow).getByText('Miss')).toHaveClass('pill', 'pill-miss');
    // A miss deals no damage: no colored damage cell to show.
    expect(missRow.querySelector('.dmg-shield')).toBeNull();
    // Owner follow-up: color-coded text and a row tint so "who's attacking" reads without
    // checking the Attacker column on every row.
    expect(hitRow).toHaveClass('attacker-enemy');
    expect(within(hitRow).getByText('Enemy')).toHaveClass('attacker-enemy');
    expect(missRow).toHaveClass('attacker-player');
    expect(within(missRow).getByText('You')).toHaveClass('attacker-player');
    // No bonus this attack: the "+ 0" term is left out rather than shown as noise.
    expect(rows[3]).toHaveTextContent('17 + 5 = 22 / 10');
    // A report resolved before this breakdown existed has rounds but no pdf/bonus at all —
    // must keep reading back as the old plain format, not a broken "NaN" sum.
    expect(missRow).toHaveTextContent('6 / 12');

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
            stats: STATS,
            view: 'summary',
            lines: [{ text: 'Ship adrift', segments: [{ t: 'text', value: 'Ship adrift' }] }],
          },
          { status: 200 },
        ),
      ),
      http.get('/v1/reports', () => HttpResponse.json({ items: [] }, { status: 200 })),
    );
    renderWithRouter(routes, { initialEntries: ['/report/m-99'] });
    expect(await screen.findByTestId('debrief')).toHaveTextContent('Ship adrift');
  });

  it('keeps the tab bar on screen while the next view loads', async () => {
    server.use(
      http.get('/v1/reports/:missionId', async ({ request }) => {
        const view = new URL(request.url).searchParams.get('view') ?? 'narrative';
        if (view === 'log') await delay(200);
        return HttpResponse.json(
          {
            locale: 'en',
            outcome: 'success',
            stats: STATS,
            view: view === 'log' ? 'log' : 'narrative',
            ...(view === 'log'
              ? { lines: [{ text: 'Log line', segments: [{ t: 'text', value: 'Log line' }] }] }
              : {
                  chapters: [
                    {
                      leg: 1,
                      header: {
                        text: 'Story line',
                        segments: [{ t: 'text', value: 'Story line' }],
                      },
                      lines: [],
                    },
                  ],
                }),
          },
          { status: 200 },
        );
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/report/m-1'] });
    await screen.findByText('Story line');

    fireEvent.click(screen.getByRole('tab', { name: 'Log' }));
    // Mid-load: still the previous view, still the tabs — no full-page "Loading".
    expect(screen.getByRole('tab', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByText('Story line')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Log' })).toHaveAttribute('aria-selected', 'true'),
    );
  });

  it('opens a detail popup for a loot reference', async () => {
    server.use(
      http.get('/v1/reports/:missionId', () =>
        HttpResponse.json(
          {
            locale: 'en',
            outcome: 'success',
            stats: STATS,
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
            stats: STATS,
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

  it('the debrief says what pirates took and how the fights went', async () => {
    server.use(
      http.get('/v1/reports/:missionId', () =>
        HttpResponse.json(
          {
            locale: 'en',
            outcome: 'failed',
            stats: {
              ...STATS,
              fights: { won: 0, lost: 1, escaped: 1, drawn: 2, pvp: 0 },
              pirates: { stolenParts: 2, motive: 'parts' },
            },
            view: 'summary',
            lines: [{ text: 'Lost', segments: [{ t: 'text', value: 'Lost' }] }],
          },
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/report/m-1'] });
    const debrief = await screen.findByTestId('debrief');
    expect(debrief).toHaveTextContent('Parts stolen');
    expect(debrief).toHaveTextContent('0 won · 1 lost · 1 escaped · 2 drawn');
  });

  it('never says a shield took 0 damage on a ship that never had one', async () => {
    server.use(
      http.get('/v1/reports/:missionId', () =>
        HttpResponse.json(
          {
            locale: 'en',
            outcome: 'success',
            stats: {
              ...STATS,
              damage: { shield: 0, armor: 6, hull: 2 },
              hasShield: false,
            },
            view: 'summary',
            lines: [{ text: 'Summary', segments: [{ t: 'text', value: 'Summary' }] }],
          },
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/report/m-1'] });
    const debrief = await screen.findByTestId('debrief');
    expect(debrief).toHaveTextContent('Armor 6 · hull 2');
    expect(debrief).not.toHaveTextContent('Shield');
  });

  it('the Details tab shows the parts-damage table (before/after bars), and nothing for a quiet run', async () => {
    server.use(
      http.get('/v1/reports/:missionId', () =>
        HttpResponse.json(
          {
            locale: 'en',
            outcome: 'success',
            stats: {
              ...STATS,
              partsDamage: [
                {
                  partId: 'p1',
                  partType: 'engine_chem_small',
                  name: 'Small Chem Engine',
                  before: 80,
                  after: 55,
                },
              ],
            },
            view: 'summary',
            lines: [{ text: 'Summary', segments: [{ t: 'text', value: 'Summary' }] }],
          },
          { status: 200 },
        ),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/report/m-1'] });
    fireEvent.click(await screen.findByRole('tab', { name: 'Details' }));
    const table = await screen.findByTestId('parts-damage');
    expect(table).toHaveTextContent('Small Chem Engine');
    expect(table).toHaveTextContent('80% → 55%');
    expect(table).toHaveTextContent('−25');
    // Switching back to Summary hides the damage table (it only shows on its own tab).
    fireEvent.click(screen.getByRole('tab', { name: 'Summary' }));
    await waitFor(() => expect(screen.queryByTestId('parts-damage')).not.toBeInTheDocument());
  });
});
