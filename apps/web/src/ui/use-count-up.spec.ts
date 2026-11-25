import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useCountUp } from './use-count-up';

function setReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

describe('useCountUp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  it('with reduced motion and animateOnMount the first render already shows the final value', () => {
    setReducedMotion(true);
    const { result } = renderHook(() => useCountUp(500, { animateOnMount: true }));
    expect(result.current.shown).toBe(500);
  });

  it('returns the value on the first render, without animation', () => {
    const { result } = renderHook(() => useCountUp(500));
    expect(result.current).toEqual({ shown: 500, direction: null });
  });

  it('counts through intermediate values and ends exactly on the target', () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), { initialProps: { v: 0 } });
    rerender({ v: 1000 });
    expect(result.current.direction).toBe('rise');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.shown).toBeGreaterThan(0);
    expect(result.current.shown).toBeLessThan(1000);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.shown).toBe(1000);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.direction).toBeNull();
  });

  it('continues from the displayed number when a second change comes mid-count', () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), { initialProps: { v: 0 } });
    rerender({ v: 1000 });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const mid = result.current.shown;
    rerender({ v: 2000 });
    act(() => {
      vi.advanceTimersByTime(30);
    });
    expect(result.current.shown).toBeGreaterThanOrEqual(mid);
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(result.current.shown).toBe(2000);
  });

  it('counts down with direction fall', () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), {
      initialProps: { v: 1000 },
    });
    rerender({ v: 0 });
    expect(result.current.direction).toBe('fall');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.shown).toBeLessThan(1000);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.shown).toBe(0);
  });

  it('shows the target at once with reduced motion', () => {
    setReducedMotion(true);
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), { initialProps: { v: 10 } });
    rerender({ v: 900 });
    expect(result.current).toEqual({ shown: 900, direction: null });
  });

  it('counts on the first render from `from` with animateOnMount', () => {
    const { result } = renderHook(() => useCountUp(1000, { from: 200, animateOnMount: true }));
    expect(result.current.shown).toBe(200);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.shown).toBeGreaterThan(200);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.shown).toBe(1000);
  });

  it('counts from 0 with animateOnMount and no from', () => {
    const { result } = renderHook(() => useCountUp(50, { animateOnMount: true }));
    expect(result.current.shown).toBe(0);
  });

  it('clears its timers on unmount', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender, unmount } = renderHook(({ v }) => useCountUp(v), { initialProps: { v: 0 } });
    rerender({ v: 1000 });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('clears the direction when the change lands on the displayed number', () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), { initialProps: { v: 0 } });
    rerender({ v: 1000 });
    expect(result.current.direction).toBe('rise');
    act(() => {
      vi.advanceTimersByTime(30);
    });
    const now = result.current.shown;
    rerender({ v: now });
    expect(result.current.direction).toBeNull();
  });

  it('clears the direction when reduced motion turns on mid-flash', () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), { initialProps: { v: 0 } });
    rerender({ v: 1000 });
    expect(result.current.direction).toBe('rise');
    setReducedMotion(true);
    rerender({ v: 2000 });
    expect(result.current).toEqual({ shown: 2000, direction: null });
  });

  it('ends exactly on the target under StrictMode and leaves no timers', () => {
    const { result, unmount } = renderHook(() => useCountUp(800, { animateOnMount: true }), {
      wrapper: StrictMode,
    });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(result.current.shown).toBe(800);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
