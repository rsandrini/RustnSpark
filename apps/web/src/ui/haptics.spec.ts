import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haptic } from './haptics';

function setVibrate(value: unknown) {
  Object.defineProperty(navigator, 'vibrate', { value, configurable: true });
}

describe('haptic', () => {
  beforeEach(() => localStorage.removeItem('rs.haptics'));
  afterEach(() => {
    delete (navigator as { vibrate?: unknown }).vibrate;
    localStorage.removeItem('rs.haptics');
  });

  it('uses one pattern per kind', () => {
    const vibrate = vi.fn(() => true);
    setVibrate(vibrate);
    haptic('tap');
    haptic('success');
    haptic('warn');
    haptic('error');
    expect(vibrate.mock.calls).toEqual([[15], [[20, 40, 30]], [40], [[60, 40, 60]]]);
  });

  it('does nothing when the pilot turned it off', () => {
    const vibrate = vi.fn(() => true);
    setVibrate(vibrate);
    localStorage.setItem('rs.haptics', 'off');
    window.dispatchEvent(new StorageEvent('storage', { key: 'rs.haptics' }));
    haptic('tap');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does nothing, and does not throw, without vibrate or when it throws', () => {
    expect(() => haptic('success')).not.toThrow();
    setVibrate(() => {
      throw new Error('blocked');
    });
    expect(() => haptic('success')).not.toThrow();
  });
});
