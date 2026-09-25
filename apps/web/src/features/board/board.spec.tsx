import { describe, it, expect, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { resetBoardState } from '../../test/msw/handlers';
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

describe('board (S10.6)', () => {
  beforeEach(() => {
    resetBoardState();
    server.use(onboarded());
  });

  it('renders offers with eligibility, blocked reasons and type filters', async () => {
    renderWithRouter(routes, { initialEntries: ['/board'] });

    expect(await screen.findByRole('heading', { name: 'Mission board' })).toBeInTheDocument();
    expect(await screen.findByText('Delivery — Porto Ceres → Portão Kessler')).toBeInTheDocument();
    expect(screen.getAllByText('Eligible')).toHaveLength(3);
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Needs a mining system')).toBeInTheDocument();
    expect(screen.getByText('Mobility too low')).toBeInTheDocument();
    expect(screen.getByText('On hold')).toBeInTheDocument();
    expect(screen.getByText(/Reward 1200/)).toBeInTheDocument();

    expect(document.querySelectorAll('.item')).toHaveLength(4);
    fireEvent.click(screen.getByRole('tab', { name: 'Mining' }));
    expect(document.querySelectorAll('.item')).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'All missions' }));
    expect(document.querySelectorAll('.item')).toHaveLength(4);
  });

  it('accepts an eligible offer and moves on to the transit screen', async () => {
    const { router } = renderWithRouter(routes, { initialEntries: ['/board'] });

    const acceptButtons = await screen.findAllByRole('button', { name: 'Accept' });
    expect(acceptButtons).toHaveLength(4);
    fireEvent.click(acceptButtons[0] as Element);

    await waitFor(() => expect(router.state.location.pathname).toBe('/transit'));
  });

  it('holds an offer and releases it again', async () => {
    renderWithRouter(routes, { initialEntries: ['/board'] });

    const holdButtons = await screen.findAllByRole('button', { name: 'Hold' });
    expect(holdButtons).toHaveLength(3);
    fireEvent.click(holdButtons[1] as Element);

    await waitFor(() => expect(screen.getAllByText('On hold')).toHaveLength(2));
    const releaseButtons = await screen.findAllByRole('button', { name: 'Release' });
    fireEvent.click(releaseButtons[0] as Element);

    await waitFor(() => expect(screen.getAllByText('On hold')).toHaveLength(1));
    expect(screen.getAllByRole('button', { name: 'Hold' })).toHaveLength(3);
  });

  it('reads the board location from the query string', async () => {
    renderWithRouter(routes, { initialEntries: ['/board?location=gate'] });

    const heading = await screen.findByRole('heading', { name: 'Mission board' });
    expect(heading.nextElementSibling?.textContent).toBe('Portão Kessler');
    expect(document.querySelectorAll('.item')).toHaveLength(4);
  });
});
