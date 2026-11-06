import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTrayDrag } from './use-tray-drag';
import type { DropPreview, ShipYardHandle } from './ship-yard';

const fits: DropPreview = { gx: 4, gy: 2, width: 1, height: 1, valid: true };
const press = (pointerType = 'mouse', button = 0) =>
  ({ clientX: 100, clientY: 100, pointerType, button }) as unknown as ReactPointerEvent;

function setup(options: { enabled?: boolean; preview?: DropPreview | null } = {}) {
  const cellFor = vi.fn(() => (options.preview === undefined ? fits : options.preview));
  const yard = { current: { cellFor, rotateGhost: vi.fn() } as ShipYardHandle };
  const onDrop = vi.fn();
  const view = renderHook(() => useTrayDrag({ yard, enabled: options.enabled ?? true, onDrop }));
  return { view, cellFor, onDrop };
}
const move = (x: number, y: number) =>
  act(() => {
    fireEvent.pointerMove(window, { clientX: x, clientY: y });
  });

describe('useTrayDrag', () => {
  afterEach(() => {
    document.body.classList.remove('dragging-part');
  });

  it('a press that moves less than 6 px is still a click: no drag, nothing dropped', () => {
    const { view, onDrop } = setup();
    act(() => view.result.current.begin('part-a', press()));
    move(103, 102);
    expect(view.result.current.dragging).toBeNull();
    act(() => {
      fireEvent.pointerUp(window);
    });
    expect(onDrop).not.toHaveBeenCalled();
    expect(view.result.current.consumeClick()).toBe(false);
  });

  it('moving past the threshold starts a drag that outlines the landing cell', () => {
    const { view, cellFor } = setup();
    act(() => view.result.current.begin('part-a', press()));
    move(140, 100);
    expect(view.result.current.dragging).toMatchObject({
      partInstanceId: 'part-a',
      x: 140,
      y: 100,
      rot: 0,
    });
    expect(view.result.current.dropPreview).toEqual(fits);
    expect(cellFor).toHaveBeenLastCalledWith('part-a', 140, 100, 0);
    expect(document.body.classList.contains('dragging-part')).toBe(true);
  });

  it('releasing over a fitting spot drops the part there, and the click that follows is eaten once', () => {
    const { view, onDrop } = setup();
    act(() => view.result.current.begin('part-a', press()));
    move(140, 100);
    act(() => {
      fireEvent.pointerUp(window);
    });
    expect(onDrop).toHaveBeenCalledWith('part-a', 4, 2, 0);
    expect(view.result.current.dragging).toBeNull();
    expect(document.body.classList.contains('dragging-part')).toBe(false);
    expect(view.result.current.consumeClick()).toBe(true);
    expect(view.result.current.consumeClick()).toBe(false);
  });

  it('releasing over a spot that does not fit, or off the yard, drops nothing', () => {
    for (const preview of [{ ...fits, valid: false }, null]) {
      const { view, onDrop } = setup({ preview });
      act(() => view.result.current.begin('part-a', press()));
      move(140, 100);
      act(() => {
        fireEvent.pointerUp(window);
      });
      expect(onDrop).not.toHaveBeenCalled();
    }
  });

  it('Escape and a cancelled pointer end the drag without dropping', () => {
    for (const end of [
      () => fireEvent.keyDown(window, { key: 'Escape' }),
      () => fireEvent.pointerCancel(window),
    ]) {
      const { view, onDrop } = setup();
      act(() => view.result.current.begin('part-a', press()));
      move(140, 100);
      act(() => {
        end();
      });
      expect(view.result.current.dragging).toBeNull();
      fireEvent.pointerUp(window);
      expect(onDrop).not.toHaveBeenCalled();
    }
  });

  it('never starts for a finger, a frozen ship or a right-click', () => {
    for (const [options, event] of [
      [{}, press('touch')],
      [{ enabled: false }, press()],
      [{}, press('mouse', 2)],
    ] as const) {
      const { view, onDrop } = setup(options);
      act(() => view.result.current.begin('part-a', event));
      move(160, 100);
      expect(view.result.current.dragging).toBeNull();
      fireEvent.pointerUp(window);
      expect(onDrop).not.toHaveBeenCalled();
    }
  });

  it('rotate turns the carried part, asks the yard again with the new rotation, and drops it turned', () => {
    const { view, cellFor, onDrop } = setup();
    act(() => view.result.current.begin('part-a', press()));
    move(140, 100);
    act(() => view.result.current.rotate());
    expect(view.result.current.dragging?.rot).toBe(90);
    expect(cellFor).toHaveBeenLastCalledWith('part-a', 140, 100, 90);
    act(() => {
      fireEvent.pointerUp(window);
    });
    expect(onDrop).toHaveBeenCalledWith('part-a', 4, 2, 90);
  });

  it('rotate does nothing when no drag is live', () => {
    const { view, cellFor } = setup();
    act(() => view.result.current.rotate());
    expect(cellFor).not.toHaveBeenCalled();
  });

  it('stops listening when it unmounts mid-drag', () => {
    const { view, onDrop } = setup();
    act(() => view.result.current.begin('part-a', press()));
    move(140, 100);
    view.unmount();
    fireEvent.pointerUp(window);
    expect(onDrop).not.toHaveBeenCalled();
    expect(document.body.classList.contains('dragging-part')).toBe(false);
  });
});
