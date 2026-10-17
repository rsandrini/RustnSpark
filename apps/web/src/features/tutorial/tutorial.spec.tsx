import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { resetEconomyState, ship } from '../../test/msw/handlers';
import { routes } from '../../app/router';
import { markVisited } from './tutorial-store';

let tutorialDone = false;
const saved: boolean[] = [];

const pilot = () => [
  http.get('/v1/players/me', () =>
    HttpResponse.json({
      id: 'player-1',
      name: 'Test Pilot',
      credits: 100,
      role: 'PLAYER',
      locale: 'en',
      factionId: 'luna',
      tutorialDone,
    }),
  ),
  http.post('/v1/players/me/tutorial', async ({ request }) => {
    const body = (await request.json()) as { done: boolean };
    tutorialDone = body.done;
    saved.push(body.done);
    return HttpResponse.json({ tutorialDone });
  }),
];

describe('newcomer tutorial', () => {
  beforeEach(() => {
    resetEconomyState();
    window.localStorage.clear();
    tutorialDone = false;
    saved.length = 0;
    server.use(...pilot());
  });

  it('shows the checklist for a pilot who has not finished or skipped it', async () => {
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const card = await screen.findByTestId('tutorial-card');
    expect(within(card).getByRole('heading', { name: 'Getting started' })).toBeInTheDocument();
    expect(within(card).getAllByRole('listitem')).toHaveLength(7);
    expect(within(card).getByRole('link', { name: 'Take me there' })).toBeInTheDocument();
  });

  it('is not shown once the server says it is done', async () => {
    tutorialDone = true;
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    await screen.findByRole('heading', { name: 'My Ship' });
    expect(screen.queryByTestId('tutorial-card')).not.toBeInTheDocument();
  });

  it('skip asks first, then saves on the server and the card goes away for good', async () => {
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const card = await screen.findByTestId('tutorial-card');
    fireEvent.click(within(card).getByRole('button', { name: 'Skip tutorial' }));
    expect(saved).toEqual([]); // nothing saved until it is confirmed
    fireEvent.click(within(card).getByRole('button', { name: 'Keep it' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Skip tutorial' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Yes, skip it' }));
    await waitFor(() => expect(screen.queryByTestId('tutorial-card')).not.toBeInTheDocument());
    expect(saved).toEqual([true]);
  });

  it('can be brought back from the account menu', async () => {
    tutorialDone = true;
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    await screen.findByRole('heading', { name: 'My Ship' });
    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Getting started' }));
    expect(await screen.findByTestId('tutorial-card')).toBeInTheDocument();
    expect(saved).toEqual([false]);
  });

  it('collapses to a pill and opens again', async () => {
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const card = await screen.findByTestId('tutorial-card');
    fireEvent.click(within(card).getByRole('button', { name: 'Hide' }));
    const pill = await screen.findByRole('button', { name: /Getting started/ });
    expect(pill).toHaveTextContent('/7');
    fireEvent.click(pill);
    expect(await screen.findByRole('heading', { name: 'Getting started' })).toBeInTheDocument();
  });

  it('ticks "Read the ports" only when every part is connected and the yard has been opened', async () => {
    markVisited('player-1', 'yard');
    const built = (disconnectedPartIds: string[]) =>
      http.get('/v1/ships', () =>
        HttpResponse.json([
          { ...ship(), disconnectedPartIds, sheet: { ...ship().sheet, structureUsed: 10 } },
        ]),
      );
    server.use(built(['part-1']));
    const first = renderWithRouter(routes, { initialEntries: ['/ship'] });
    const card = await screen.findByTestId('tutorial-card');
    expect(within(card).getByText('Read the ports').closest('li')).not.toHaveClass('done');
    first.unmount();

    server.use(built([]));
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const again = await screen.findByTestId('tutorial-card');
    await waitFor(() =>
      expect(within(again).getByText('Read the ports').closest('li')).toHaveClass('done'),
    );
  });

  it('ticks a step when its screen has been opened', async () => {
    markVisited('player-1', 'report');
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const card = await screen.findByTestId('tutorial-card');
    const step = within(card).getByText('Read your report').closest('li');
    expect(step).toHaveClass('done');
  });
});
