import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../test/msw/server';
import { renderWithProviders } from '../test/utils';
import { NoticeBanner } from './NoticeBanner';

const notice = {
  id: 'n1',
  message: { en: 'Maintenance at noon', 'pt-BR': 'Manutenção ao meio-dia' },
};

describe('NoticeBanner (S11.2)', () => {
  it('shows an active broadcast in the player language and lets the player dismiss it', async () => {
    sessionStorage.clear();
    server.use(http.get('/v1/system/notices', () => HttpResponse.json({ items: [notice] })));
    const user = userEvent.setup();
    renderWithProviders(<NoticeBanner />);

    expect(await screen.findByText(/Maintenance at noon/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Maintenance at noon/)).not.toBeInTheDocument();
  });

  it('renders nothing when there are no notices', async () => {
    sessionStorage.clear();
    const { container } = renderWithProviders(<NoticeBanner />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector('.notice-banner')).toBeNull();
  });
});
