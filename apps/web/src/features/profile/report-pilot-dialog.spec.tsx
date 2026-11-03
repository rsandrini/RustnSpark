import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, client } from '../../api/client';
import '../../i18n';
import { ReportPilotDialog } from './report-pilot-dialog';

function renderDialog() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <ReportPilotDialog playerName="Bob" open onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('ReportPilotDialog', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reports the pilot by name with the chosen subject and reason', async () => {
    const post = vi.spyOn(client, 'post').mockResolvedValue({ id: 'r1' });
    renderDialog();
    const [subject, reason] = screen.getAllByRole('combobox');
    await userEvent.selectOptions(subject!, 'PILOT_NAME');
    await userEvent.selectOptions(reason!, 'IMPERSONATION');
    await userEvent.type(screen.getByRole('textbox'), 'pretends to be staff');
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(post).toHaveBeenCalledWith('/v1/moderation/reports', {
      playerName: 'Bob',
      subject: 'PILOT_NAME',
      reason: 'IMPERSONATION',
      note: 'pretends to be staff',
    });
  });

  it('says so when the report was already filed', async () => {
    vi.spyOn(client, 'post').mockRejectedValue(
      new ApiError(409, 'ALREADY_REPORTED', 'ALREADY_REPORTED'),
    );
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already reported');
  });
});
