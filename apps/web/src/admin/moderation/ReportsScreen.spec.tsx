import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '../../api/client';
import '../../i18n';
import { ReportsScreen } from './ReportsScreen';

const row = {
  id: 'r1',
  subject: 'SHIP_NAME',
  reason: 'OFFENSIVE',
  note: 'rude',
  reportedText: 'LUN-Bad Name',
  status: 'OPEN',
  createdAt: '2026-11-02T12:00:00.000Z',
  reporter: { id: 'p1', name: 'Alice' },
  target: { id: 'p2', name: 'Bob', shipName: 'LUN-Bad Name', banned: false },
  reportsAgainstTarget: 2,
  review: null,
};

function renderScreen() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ReportsScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReportsScreen', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows what was reported and who by, and sends the decision with the note', async () => {
    vi.spyOn(client, 'get').mockResolvedValue([row] as never);
    const post = vi.spyOn(client, 'post').mockResolvedValue({});
    renderScreen();

    const card = await screen.findByTestId('report-row');
    expect(within(card).getByTestId('report-text')).toHaveTextContent('LUN-Bad Name');
    expect(card).toHaveTextContent('reported by Alice');
    expect(card).toHaveTextContent('2 report(s) against this pilot');
    await userEvent.type(within(card).getByRole('textbox'), 'rude indeed');
    await userEvent.click(within(card).getByRole('button', { name: 'Reset ship name' }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith(
      '/v1/admin/moderation/reports/r1/review',
      { action: 'RESET_SHIP_NAME', note: 'rude indeed' },
      expect.objectContaining({ idempotencyKey: expect.any(String) as string }),
    );
  });

  it('shows the decision on a reviewed report instead of the buttons', async () => {
    vi.spyOn(client, 'get').mockResolvedValue([
      {
        ...row,
        status: 'ACTIONED',
        review: { by: 'a1', at: '2026-11-02T13:00:00.000Z', outcome: 'BAN', note: 'abusive' },
      },
    ] as never);
    renderScreen();
    expect(await screen.findByTestId('report-outcome')).toHaveTextContent('Account banned');
    expect(screen.queryByRole('button', { name: 'Ban account' })).toBeNull();
  });
});
