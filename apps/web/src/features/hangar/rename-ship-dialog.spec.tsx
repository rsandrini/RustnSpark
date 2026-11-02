import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, client } from '../../api/client';
import '../../i18n';
import { RenameShipDialog } from './rename-ship-dialog';

const quote = { prefix: 'LUN-', price: 1000, name: 'LUN-Tern' };

function renderDialog() {
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RenameShipDialog shipId="ship-1" open onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

describe('RenameShipDialog', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('shows the fixed prefix and the price, starts from the current name, and posts the new one', async () => {
    vi.spyOn(client, 'get').mockResolvedValue(quote);
    const post = vi.spyOn(client, 'post').mockResolvedValue({ ...quote, name: 'LUN-Star' });
    const onClose = renderDialog();

    await waitFor(() => expect(screen.getByTestId('rename-prefix')).toHaveTextContent('LUN-'));
    expect(screen.getByTestId('rename-price')).toHaveTextContent('1,000 ¢');
    const input = screen.getByRole('textbox');
    await waitFor(() => expect(input).toHaveValue('Tern'));
    await userEvent.clear(input);
    await userEvent.type(input, 'Star');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith(
      '/v1/ships/ship-1/rename',
      { name: 'Star' },
      expect.objectContaining({ idempotencyKey: expect.any(String) as string }),
    );
  });

  it('says why a refused name was refused and keeps the dialog open', async () => {
    vi.spyOn(client, 'get').mockResolvedValue(quote);
    vi.spyOn(client, 'post').mockRejectedValue(
      new ApiError(409, 'SHIP_NAME_BLOCKED', 'SHIP_NAME_BLOCKED'),
    );
    const onClose = renderDialog();
    const input = await screen.findByRole('textbox');
    await waitFor(() => expect(input).toHaveValue('Tern'));
    await userEvent.type(input, 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That name is not allowed.');
    expect(onClose).not.toHaveBeenCalled();
  });
});
