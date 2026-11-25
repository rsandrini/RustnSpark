import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import i18n from '../i18n';
import { AccountMenu } from './AccountMenu';

const auth = vi.hoisted(() => ({ credits: 100 }));

vi.mock('../features/auth/auth.hooks', () => ({
  useAuth: () => ({
    user: { id: 'p1', name: 'Test Pilot', credits: auth.credits, role: 'PLAYER' },
  }),
  useLogout: () => ({ mutate: () => undefined }),
}));
vi.mock('../features/auth/auth.context', () => ({
  useAuthContext: () => ({ reloadProfile: () => undefined }),
}));
vi.mock('../features/dialogue/use-dialogue', () => ({
  useDialogueState: () => ({ data: undefined }),
  useDialogueActions: () => ({
    replay: { mutate: () => undefined },
    setEnabled: { mutate: () => undefined },
  }),
}));
vi.mock('../features/prologue/prologue-mode', () => ({
  usePrologueMode: () => ({ active: false }),
}));

const client = new QueryClient();
const tree = () => (
  <I18nextProvider i18n={i18n}>
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AccountMenu />
      </MemoryRouter>
    </QueryClientProvider>
  </I18nextProvider>
);

describe('AccountMenu wallet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (window as { matchMedia?: unknown }).matchMedia;
    auth.credits = 100;
  });
  afterEach(() => vi.useRealTimers());

  it('counts to a new credit value, keeping the accessible name, the pulse and the delta', () => {
    const view = render(tree());
    const wallet = screen.getByTestId('topbar-wallet');
    expect(wallet).toHaveAttribute('aria-label', 'Credits');
    expect(wallet).toHaveTextContent('100 ¢');
    auth.credits = 1100;
    view.rerender(tree());
    expect(screen.getByTestId('topbar-wallet')).toHaveClass('pulse');
    expect(screen.getByTestId('wallet-delta')).toHaveTextContent('+1,000 ¢');
    const animated = wallet.querySelector('[aria-hidden="true"]')!;
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const mid = Number(animated.textContent?.replace(/\D/g, ''));
    expect(mid).toBeGreaterThan(100);
    expect(mid).toBeLessThan(1100);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(animated).toHaveTextContent('1,100 ¢');
    expect(wallet).toHaveAttribute('aria-label', 'Credits');
  });
});
