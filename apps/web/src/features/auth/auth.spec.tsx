import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { routes } from '../../app/router';

describe('auth flow', () => {
  it('logs an onboarded pilot in and lands on My Ship (the former home page)', async () => {
    server.use(
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
      ),
    );

    const user = userEvent.setup();
    renderWithRouter(routes, { initialEntries: ['/login'] });

    await user.type(screen.getByLabelText(/email/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('heading', { name: 'My Ship' })).toBeInTheDocument();
  });

  it('routes a pilot without a faction to onboarding after login', async () => {
    const user = userEvent.setup();
    renderWithRouter(routes, { initialEntries: ['/login'] });

    await user.type(screen.getByLabelText(/email/i), 'fresh@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(
      await screen.findByRole('heading', { name: /choose your faction/i }),
    ).toBeInTheDocument();
  });

  it('shows an error message when login returns 401', async () => {
    server.use(
      http.post('/v1/auth/login', () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 }),
      ),
    );

    const user = userEvent.setup();
    renderWithRouter(routes, { initialEntries: ['/login'] });

    await user.type(screen.getByLabelText(/email/i), 'nobody@example.com');
    await user.type(screen.getByLabelText(/password/i), 'wrong');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
  });

  it('submits the register form and lands on onboarding', async () => {
    const user = userEvent.setup();
    renderWithRouter(routes, { initialEntries: ['/register'] });

    await user.type(screen.getByLabelText(/name/i), 'ace');
    await user.type(screen.getByLabelText(/email/i), 'ace@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(
      await screen.findByRole('heading', { name: /choose your faction/i }),
    ).toBeInTheDocument();
  });

  it('submits the forgot-password form and shows a success message', async () => {
    const user = userEvent.setup();
    renderWithRouter(routes, { initialEntries: ['/forgot-password'] });

    await user.type(screen.getByLabelText(/email/i), 'pilot@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(/if this email is registered/i)).toBeInTheDocument();
  });

  it('submits the reset-password form and shows a success message', async () => {
    const user = userEvent.setup();
    renderWithRouter(routes, { initialEntries: ['/reset-password?token=abc123'] });

    await user.type(screen.getByLabelText(/^new password$/i), 'new-password-2');
    await user.type(screen.getByLabelText(/confirm new password/i), 'new-password-2');
    await user.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByText(/password updated/i)).toBeInTheDocument();
  });

  it('shows a validation error when reset passwords do not match', async () => {
    const user = userEvent.setup();
    renderWithRouter(routes, { initialEntries: ['/reset-password?token=abc123'] });

    await user.type(screen.getByLabelText(/^new password$/i), 'new-password-2');
    await user.type(screen.getByLabelText(/confirm new password/i), 'different-password');
    await user.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
  });

  it('the sign-in page shows the game: screens, classes, missions and costs', async () => {
    renderWithRouter(routes, { initialEntries: ['/login'] });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Rust and Spark' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/space logistics and ship-building strategy game/i),
    ).toBeInTheDocument();
    // not an idle game: the page never calls it that
    expect(screen.queryByText(/idle/i)).toBeNull();
    // two real screens, the ship classes and every kind of mission
    expect(
      screen.getByRole('heading', { name: 'Your ship is a puzzle of parts' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Different ships, different jobs' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Pick a job. Beat the field.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'A mission for every ship' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Not a game you can just leave running' }),
    ).toBeInTheDocument();
    // facts from the server plus the constant counts
    expect(await screen.findByTestId('landing-facts')).toHaveTextContent('220 parts to build with');
    expect(screen.getByTestId('landing-facts')).toHaveTextContent('6 ship classes');
    expect(screen.getByTestId('landing-facts')).toHaveTextContent('8 kinds of mission');
    // no mention of the old powers section, factions or free pilots
    expect(screen.queryByRole('heading', { name: 'Four powers, one sector' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Luna Authority' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Pirates' })).toBeNull();
    expect(screen.getByRole('main')).not.toHaveTextContent(/powers|free pilot/i);
    // the way in is still right there
    expect(screen.getByRole('tab', { name: 'Create account' })).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.getByRole('link', { name: 'Create your pilot' })).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.getByRole('link', { name: 'Forgot your password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('the sign-in page still works if the public data cannot be loaded', async () => {
    server.use(http.get('/v1/public/landing', () => HttpResponse.json({}, { status: 500 })));
    renderWithRouter(routes, { initialEntries: ['/login'] });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Rust and Spark' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    // server facts are gone, but the constant counts still show
    const facts = screen.getByTestId('landing-facts');
    expect(facts).toHaveTextContent('6 ship classes');
    expect(facts).toHaveTextContent('8 kinds of mission');
    expect(facts).not.toHaveTextContent('parts to build with');
    // every showcase block still renders without the server
    expect(
      screen.getByRole('heading', { name: 'Your ship is a puzzle of parts' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Different ships, different jobs' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Pick a job. Beat the field.' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'A mission for every ship' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Not a game you can just leave running' }),
    ).toBeInTheDocument();
  });

  it('sign up lives on the same page: /register is the landing with the Create account tab open', async () => {
    renderWithRouter(routes, { initialEntries: ['/register'] });
    // the hero and the story are still there, around the form
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Rust and Spark' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Your ship is a puzzle of parts' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Create account' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText(/^name/i)).toBeInTheDocument();
    // and the way back to signing in is a tab, not a separate page
    expect(screen.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});
