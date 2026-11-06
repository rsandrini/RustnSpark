import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderHook } from '@testing-library/react';
import { useRotateKey } from './use-rotate-key';

function setup(target: string | null = 'part-a', enabled = true) {
  const onRotate = vi.fn();
  renderHook(() => useRotateKey({ enabled, target: () => target, onRotate }));
  return onRotate;
}

describe('useRotateKey', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('calls onRotate with the target on a plain r and on R, even on another keyboard layout', () => {
    const onRotate = setup();
    fireEvent.keyDown(window, { key: 'r' });
    fireEvent.keyDown(window, { key: 'R' });
    fireEvent.keyDown(window, { key: 'к', code: 'KeyR' });
    expect(onRotate).toHaveBeenCalledTimes(3);
    expect(onRotate).toHaveBeenCalledWith('part-a');
  });

  it('ignores Ctrl+R, Meta+R and Alt+R (Ctrl+R reloads the page)', () => {
    const onRotate = setup();
    fireEvent.keyDown(window, { key: 'r', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'r', metaKey: true });
    fireEvent.keyDown(window, { key: 'r', altKey: true });
    expect(onRotate).not.toHaveBeenCalled();
  });

  it('turns once per press: a held key is ignored', () => {
    const onRotate = setup();
    fireEvent.keyDown(window, { key: 'r', repeat: true });
    expect(onRotate).not.toHaveBeenCalled();
  });

  it('ignores r typed into an input, a textarea, a select or an editable element', () => {
    const onRotate = setup();
    for (const tag of ['input', 'textarea', 'select']) {
      const field = document.createElement(tag);
      document.body.appendChild(field);
      fireEvent.keyDown(field, { key: 'r' });
    }
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    fireEvent.keyDown(editable, { key: 'r' });
    expect(onRotate).not.toHaveBeenCalled();
  });

  it('ignores r while a popup is open', () => {
    const onRotate = setup();
    const popup = document.createElement('div');
    popup.className = 'modal-backdrop';
    document.body.appendChild(popup);
    fireEvent.keyDown(window, { key: 'r' });
    expect(onRotate).not.toHaveBeenCalled();
  });

  it('does nothing, and leaves the key alone, when there is no target', () => {
    const onRotate = setup(null);
    const notPrevented = fireEvent.keyDown(window, { key: 'r' });
    expect(onRotate).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });

  it('does nothing when disabled', () => {
    const onRotate = setup('part-a', false);
    fireEvent.keyDown(window, { key: 'r' });
    expect(onRotate).not.toHaveBeenCalled();
  });

  it('stops listening when it unmounts', () => {
    const onRotate = vi.fn();
    const view = renderHook(() =>
      useRotateKey({ enabled: true, target: () => 'part-a', onRotate }),
    );
    view.unmount();
    fireEvent.keyDown(window, { key: 'r' });
    expect(onRotate).not.toHaveBeenCalled();
  });
});
