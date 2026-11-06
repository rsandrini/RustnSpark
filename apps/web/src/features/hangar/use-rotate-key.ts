import { useEffect, useRef } from 'react';

interface RotateKeyOptions {
  /** Off while the ship cannot be edited (out on a mission). */
  enabled: boolean;
  /** The part R turns right now: the one being dragged, else the one under the pointer, else the selected one. */
  target: () => string | null;
  onRotate: (partInstanceId: string) => void;
}

function isTyping(element: EventTarget | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return (
    element.isContentEditable ||
    element.getAttribute('contenteditable') === 'true' ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
  );
}

/**
 * R turns a part. Never with Ctrl, Meta or Alt (Ctrl+R reloads the page), never while typing or with a
 * popup open, and one turn per press (a held key repeats, and is ignored).
 */
export function useRotateKey({ enabled, target, onRotate }: RotateKeyOptions): void {
  // The latest callbacks without re-binding the listener on every render.
  const latest = useRef({ target, onRotate });
  latest.current = { target, onRotate };

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      const isR = event.key.toLowerCase() === 'r' || event.code === 'KeyR';
      if (!isR || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (isTyping(event.target) || document.querySelector('.modal-backdrop') !== null) return;
      const id = latest.current.target();
      if (id === null) return;
      event.preventDefault();
      latest.current.onRotate(id);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
