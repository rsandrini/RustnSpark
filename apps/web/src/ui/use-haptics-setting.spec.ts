import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHapticsSetting } from './use-haptics-setting';

describe('useHapticsSetting', () => {
  afterEach(() => localStorage.removeItem('rs.haptics'));

  it('is on by default, persists a change and updates every consumer at once', () => {
    const a = renderHook(() => useHapticsSetting());
    const b = renderHook(() => useHapticsSetting());
    expect(a.result.current[0]).toBe(true);
    act(() => a.result.current[1](false));
    expect(a.result.current[0]).toBe(false);
    expect(b.result.current[0]).toBe(false);
    expect(localStorage.getItem('rs.haptics')).toBe('off');
    act(() => {
      localStorage.setItem('rs.haptics', 'on');
      window.dispatchEvent(new StorageEvent('storage', { key: 'rs.haptics' }));
    });
    expect(b.result.current[0]).toBe(true);
  });
});
