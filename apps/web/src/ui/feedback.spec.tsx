import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { ReactNode } from 'react';
import {
  ANSWER_MS,
  FEEDBACK_MS,
  FeedbackProvider,
  useAnswer,
  useFeedback,
  useNotice,
} from './feedback';
import { useWalletAnswer } from './use-wallet-answer';

const ACT = 'act';
const SHIP_SCREEN = 'the ship screen';

const wrap = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <FeedbackProvider>{children}</FeedbackProvider>
  </MemoryRouter>
);

function Trigger({ next }: { next?: boolean }) {
  const { notify } = useFeedback();
  return (
    <button
      type="button"
      onClick={() =>
        notify(
          'Mission accepted. Ready for departure.',
          next ? { next: { label: 'Go', to: '/ship' } } : {},
        )
      }
    >
      {ACT}
    </button>
  );
}

describe('feedback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows one short message after an action and takes it away by itself', () => {
    render(<Trigger />, { wrapper: wrap });
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByText(ACT));
    expect(screen.getByRole('status')).toHaveTextContent('Mission accepted. Ready for departure.');
    act(() => {
      vi.advanceTimersByTime(FEEDBACK_MS + 50);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a next step on the message is a link to the next screen', () => {
    render(
      <MemoryRouter initialEntries={['/port']}>
        <FeedbackProvider>
          <Routes>
            <Route path="/port" element={<Trigger next />} />
            <Route path="/ship" element={<p>{SHIP_SCREEN}</p>} />
          </Routes>
        </FeedbackProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText(ACT));
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByText(SHIP_SCREEN)).toBeInTheDocument();
  });

  it('a screen rendered alone keeps its own inline message (no feedback host)', () => {
    const { result } = renderHook(() => useNotice());
    expect(result.current.notice).toBeNull();
    act(() => result.current.setNotice('Bought a Cargo Hold'));
    expect(result.current.notice).toBe('Bought a Cargo Hold');
  });

  it('with the host, a notice becomes the message and nothing stays inline', () => {
    const { result } = renderHook(() => useNotice(), { wrapper: wrap });
    act(() => result.current.setNotice('Tank filled'));
    expect(result.current.notice).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Tank filled');
  });

  it('a button is busy while the request runs and done for a moment after it succeeded', () => {
    const { result, rerender } = renderHook(({ pending, ok }) => useAnswer(pending, ok), {
      initialProps: { pending: false, ok: false },
    });
    expect(result.current).toBe('idle');
    rerender({ pending: true, ok: false });
    expect(result.current).toBe('busy');
    rerender({ pending: false, ok: true });
    expect(result.current).toBe('done');
    act(() => {
      vi.advanceTimersByTime(ANSWER_MS + 50);
    });
    expect(result.current).toBe('idle');
  });

  it('a failed request does not look done', () => {
    const { result, rerender } = renderHook(({ pending, ok }) => useAnswer(pending, ok), {
      initialProps: { pending: true, ok: false },
    });
    rerender({ pending: false, ok: false });
    expect(result.current).toBe('idle');
  });

  it('the wallet answers a change of credits with the amount, not the first value', () => {
    const format = (n: number) => `${n > 0 ? '+' : '-'}${Math.abs(n)}`;
    const { result, rerender } = renderHook(({ credits }) => useWalletAnswer(credits, format), {
      initialProps: { credits: 3000 },
    });
    expect(result.current.delta).toBeNull();
    rerender({ credits: 2081 });
    expect(result.current).toMatchObject({ pulse: true, delta: '-919' });
    rerender({ credits: 2081 });
    expect(result.current.delta).toBe('-919');
    rerender({ credits: 2334 });
    expect(result.current.delta).toBe('+253');
  });
});
