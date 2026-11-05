import { afterEach, describe, expect, it, vi } from 'vitest';
import { installTouchGuards } from './touch-guards';

function coarse(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches }));
}

describe('touch guards', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('swallows the long-press menu on a touch device, but keeps it in form fields', () => {
    coarse(true);
    document.body.innerHTML = '<button id="b">go</button><input id="i" />';
    const off = installTouchGuards();
    const onButton = new Event('contextmenu', { bubbles: true, cancelable: true });
    document.getElementById('b')!.dispatchEvent(onButton);
    expect(onButton.defaultPrevented).toBe(true);
    const onInput = new Event('contextmenu', { bubbles: true, cancelable: true });
    document.getElementById('i')!.dispatchEvent(onInput);
    expect(onInput.defaultPrevented).toBe(false);
    off();
  });

  it('does nothing with a mouse', () => {
    coarse(false);
    document.body.innerHTML = '<button id="b">go</button>';
    installTouchGuards();
    const event = new Event('contextmenu', { bubbles: true, cancelable: true });
    document.getElementById('b')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
