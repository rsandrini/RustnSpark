import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdClock, resetClockHold, resumeClock, serverNow } from './client';

describe('the opening can hold the clock still', () => {
  afterEach(() => {
    resetClockHold();
    vi.useRealTimers();
  });

  it('stands still while held, and goes on from where it stood', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const start = serverNow();
    vi.advanceTimersByTime(5000);
    expect(serverNow()).toBe(start + 5000);

    holdClock();
    const stopped = serverNow();
    vi.advanceTimersByTime(30_000);
    expect(serverNow()).toBe(stopped);

    resumeClock();
    expect(serverNow()).toBe(stopped);
    vi.advanceTimersByTime(2000);
    expect(serverNow()).toBe(stopped + 2000);
  });

  it('can be held at an earlier moment (the end of a leg), and holds only once', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    const start = serverNow();
    vi.advanceTimersByTime(1000);
    holdClock(start + 400);
    holdClock(start + 900);
    expect(serverNow()).toBe(start + 400);
    resumeClock();
    vi.advanceTimersByTime(100);
    expect(serverNow()).toBe(start + 500);
  });

  it('is the plain clock again after a reset', () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000_000);
    holdClock();
    vi.advanceTimersByTime(10_000);
    resumeClock();
    resetClockHold();
    expect(serverNow()).toBe(3_010_000);
  });
});
