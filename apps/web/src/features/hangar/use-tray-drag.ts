import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { movedPastThreshold, startsDrag } from './drag-geometry';
import { nextRot, type Rot } from './hangar.geometry';
import type { DropPreview, ShipYardHandle } from './ship-yard';

interface TrayDragOptions {
  /** The yard, which says where a part would land under the pointer. */
  yard: RefObject<ShipYardHandle | null>;
  /** Off while the ship cannot be edited, and on a phone (a finger keeps tap-then-tap). */
  enabled: boolean;
  /** The release: only called when the preview says the spot works. */
  onDrop: (partInstanceId: string, gx: number, gy: number, rot: Rot) => void;
}

export interface TrayDrag {
  /** The part being pulled out of the list, and where the pointer is. */
  dragging: { partInstanceId: string; x: number; y: number; rot: Rot } | null;
  dropPreview: DropPreview | null;
  /** Called by a list row on pointer down: a real drag starts once the pointer moves far enough. */
  begin: (partInstanceId: string, event: ReactPointerEvent) => void;
  /** Turns the carried part a quarter turn (the R key). */
  rotate: () => void;
  /** True once right after a real drag, so the click that follows the release does not also select the row. */
  consumeClick: () => boolean;
}

const DRAGGING_CLASS = 'dragging-part';

/**
 * Pulling a loose part from the parts list onto the ship. A press that moves less than the threshold stays
 * a click. While dragging, the yard outlines the landing cell; on release a fitting spot places the part
 * through `onDrop`, anything else leaves it in the list. Escape or a cancelled pointer ends it too.
 */
export function useTrayDrag({ yard, enabled, onDrop }: TrayDragOptions): TrayDrag {
  const [dragging, setDragging] = useState<TrayDrag['dragging']>(null);
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
  const live = useRef({ yard, enabled, onDrop });
  live.current = { yard, enabled, onDrop };
  const cleanup = useRef<(() => void) | null>(null);
  const state = useRef<{ id: string; x: number; y: number; rot: Rot; started: boolean } | null>(
    null,
  );
  const preview = useRef<DropPreview | null>(null);
  const justDragged = useRef(false);

  const refresh = useCallback(() => {
    const current = state.current;
    if (current === null || !current.started) return;
    const next = live.current.yard.current?.cellFor(current.id, current.x, current.y, current.rot);
    preview.current = next ?? null;
    setDropPreview(next ?? null);
    setDragging({ partInstanceId: current.id, x: current.x, y: current.y, rot: current.rot });
  }, []);

  const end = useCallback(() => {
    cleanup.current?.();
    cleanup.current = null;
    state.current = null;
    preview.current = null;
    document.body.classList.remove(DRAGGING_CLASS);
    setDragging(null);
    setDropPreview(null);
  }, []);

  useEffect(() => end, [end]);

  const begin = useCallback(
    (partInstanceId: string, event: ReactPointerEvent) => {
      if (!live.current.enabled || event.button !== 0 || !startsDrag(event.pointerType, true))
        return;
      end();
      const startX = event.clientX;
      const startY = event.clientY;
      state.current = { id: partInstanceId, x: startX, y: startY, rot: 0, started: false };

      const onMove = (move: PointerEvent) => {
        const current = state.current;
        if (current === null) return;
        current.x = move.clientX;
        current.y = move.clientY;
        if (!current.started) {
          if (!movedPastThreshold(startX, startY, move.clientX, move.clientY)) return;
          current.started = true;
          document.body.classList.add(DRAGGING_CLASS);
        }
        refresh();
      };
      const onUp = () => {
        const current = state.current;
        const landing = preview.current;
        const wasDrag = current?.started === true;
        if (current !== null && wasDrag && landing !== null && landing.valid) {
          live.current.onDrop(current.id, landing.gx, landing.gy, current.rot);
        }
        if (wasDrag) {
          // the click that follows this release is part of the same gesture: it must not select the row
          justDragged.current = true;
          window.setTimeout(() => {
            justDragged.current = false;
          }, 0);
        }
        end();
      };
      const onKey = (key: KeyboardEvent) => {
        if (key.key === 'Escape') end();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', end);
      window.addEventListener('keydown', onKey);
      cleanup.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', end);
        window.removeEventListener('keydown', onKey);
      };
    },
    [end, refresh],
  );

  const rotate = useCallback(() => {
    const current = state.current;
    if (current === null || !current.started) return;
    current.rot = nextRot(current.rot);
    refresh();
  }, [refresh]);

  const consumeClick = useCallback(() => {
    const was = justDragged.current;
    justDragged.current = false;
    return was;
  }, []);

  return { dragging, dropPreview, begin, rotate, consumeClick };
}
