import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { client } from '../api/client';
import '../i18n';
import { BugReportDialog } from './BugReportDialog';

function renderDialog() {
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/port']}>
        <BugReportDialog open onClose={onClose} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return onClose;
}

describe('BugReportDialog', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('keeps Send off until the message is long enough, then posts it with the screen', async () => {
    const post = vi.spyOn(client, 'post').mockResolvedValue(undefined);
    renderDialog();
    const send = screen.getByRole('button', { name: /send report/i });
    expect(send).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), 'The port page froze on repair');
    expect(send).toBeEnabled();
    await userEvent.click(send);
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(post).toHaveBeenCalledWith(
      '/v1/feedback/bug',
      expect.objectContaining({ message: 'The port page froze on repair', page: '/port' }),
    );
  });

  it('shows a failure and keeps the text', async () => {
    vi.spyOn(client, 'post').mockRejectedValue(new Error('boom'));
    renderDialog();
    await userEvent.type(screen.getByRole('textbox'), 'The port page froze on repair');
    await userEvent.click(screen.getByRole('button', { name: /send report/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('The port page froze on repair');
  });
});
