import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import {
  resetActiveState,
  resetBoardState,
  resetEconomyState,
  setMentor,
  mentorFixture,
} from '../../test/msw/handlers';
import { routes } from '../../app/router';
import { clearVisitedCache } from '../tutorial/tutorial-store';

// Every place the giver's face and voice shows up in the pilot's screens (plan §1, §9): the
// board card and row, the accepted-mission briefing, the report's closing line, the tutorial
// mentor and the faction picker. The mocks already carry Ines Moura (b-1 offer, accepted
// mission, report m-1) and Rhea Solano as luna's mentor.

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

let tutorialDone = true;

const pilotWithTutorial = () => [
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
  http.post('/v1/players/me/tutorial', () =>
    HttpResponse.json({ tutorialDone: true }, { status: 200 }),
  ),
];

async function openFullBoard(): Promise<void> {
  renderWithRouter(routes, { initialEntries: ['/hangar/board'] });
  await screen.findByRole('button', { name: 'All missions' });
  fireEvent.click(screen.getByRole('button', { name: 'All missions' }));
}

describe('quest givers in the pilot screens', () => {
  beforeEach(() => {
    resetEconomyState();
    resetBoardState();
    resetActiveState();
    setMentor(null);
    tutorialDone = true;
    // Visits from earlier tests in this file tick tutorial steps; the mentor line for "the next
    // step" only makes sense from a clean checklist.
    window.localStorage.clear();
    clearVisitedCache();
    server.use(onboarded());
  });

  it('the board card shows the giver who offered the mission, and only on that offer', async () => {
    await openFullBoard();
    // Only b-1 carries a giver in the mocks; every offer still renders its card.
    const givers = await screen.findAllByTestId('mcard-giver');
    expect(givers).toHaveLength(1);
    expect(within(givers[0]!).getByText('Ines Moura')).toBeInTheDocument();
    expect(within(givers[0]!).getByText('Dispatcher')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Offered by Ines Moura').length).toBeGreaterThan(0);
  });

  it('the accepted-mission briefing shows the giver who sent the pilot', async () => {
    renderWithRouter(routes, { initialEntries: ['/transit'] });
    const giver = await screen.findByTestId('mission-giver');
    expect(within(giver).getByText('Ines Moura')).toBeInTheDocument();
    expect(within(giver).getByText('Dispatcher')).toBeInTheDocument();
  });

  it('the report closes with the giver and their line for the result', async () => {
    renderWithRouter(routes, { initialEntries: ['/report/m-1'] });
    const giver = await screen.findByTestId('debrief-giver');
    expect(within(giver).getByText('Ines Moura')).toBeInTheDocument();
    expect(
      await screen.findByText('Good flying. Come back when the tank is full.'),
    ).toBeInTheDocument();
  });

  it('the tutorial card is a plain checklist: the mentor speaks in dialogue scenes, not here', async () => {
    setMentor(mentorFixture());
    tutorialDone = false;
    server.use(...pilotWithTutorial());
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const card = await screen.findByTestId('tutorial-card');
    expect(within(card).queryByTestId('tutorial-mentor')).not.toBeInTheDocument();
    expect(within(card).queryByText('Fill the tank first, pilot.')).not.toBeInTheDocument();
  });

  it('the faction picker replaces the selected card blurb with the leader welcome', async () => {
    // A pilot who has not chosen a faction yet is the only one who sees the picker.
    server.use(
      http.get('/v1/players/me', () =>
        HttpResponse.json({
          id: 'player-1',
          name: 'Test Pilot',
          credits: 0,
          role: 'PLAYER',
          locale: 'en',
          factionId: null,
          tutorialDone: true,
        }),
      ),
    );
    renderWithRouter(routes, { initialEntries: ['/onboarding'] });
    const luna = await screen.findByRole('radio', { name: /Luna Authority/ });
    fireEvent.click(luna);
    await waitFor(() =>
      expect(
        screen.getByText(
          'Luna keeps the lanes honest. Fly for the Authority and the paperwork works for you.',
        ),
      ).toBeInTheDocument(),
    );
  });
});
