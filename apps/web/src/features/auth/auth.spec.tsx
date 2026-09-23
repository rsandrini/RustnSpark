import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { routes } from '../../app/router';

describe('auth flow', () => {
  it('submits the login form and lands on the home page', async () => {
    const user = userEvent.setup();
    renderWithRouter(routes, { initialEntries: ['/login'] });

    await user.type(screen.getByLabelText(/email/i), 'admin@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('heading', { name: /home/i })).toBeInTheDocument();
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

    expect(
      await screen.findByText(/invalid credentials/i),
    ).toBeInTheDocument();
  });

  it('submits the register form and lands on the home page', async () => {
    const user = userEvent.setup();
    renderWithRouter(routes, { initialEntries: ['/register'] });

    await user.type(screen.getByLabelText(/callsign/i), 'ace');
    await user.type(screen.getByLabelText(/email/i), 'ace@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByRole('heading', { name: /home/i })).toBeInTheDocument();
  });
});
