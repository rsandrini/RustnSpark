import { afterEach, describe, expect, it, vi } from 'vitest';
import { liftCurtain, raiseCurtain, resetCurtain, useCurtain } from './curtain';
import { renderHook, act } from '@testing-library/react';

afterEach(() => {
  resetCurtain();
  vi.useRealTimers();
});

describe('the curtain', () => {
  it('is down by default, goes up, lifts when asked and is down again after the fade', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCurtain());
    expect(result.current).toBe('down');
    act(() => raiseCurtain());
    expect(result.current).toBe('up');
    act(() => liftCurtain());
    expect(result.current).toBe('lifting');
    void act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe('down');
  });

  it('lifts by itself if the faction page never comes', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCurtain());
    act(() => raiseCurtain());
    void act(() => vi.advanceTimersByTime(15500));
    expect(['lifting', 'down']).toContain(result.current);
  });

  it('lifting a curtain that is not up does nothing', () => {
    const { result } = renderHook(() => useCurtain());
    act(() => liftCurtain());
    expect(result.current).toBe('down');
  });
});
