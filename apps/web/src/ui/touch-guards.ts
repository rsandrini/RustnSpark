const KEEPS_MENU = 'input, textarea, select, [contenteditable="true"], .selectable';

/**
 * Touch devices only: swallow the context menu a long press opens, except in form fields (where copy and
 * paste are wanted). iOS Safari ignores `-webkit-touch-callout: none` in some versions, so the CSS in
 * styles/mobile.css is not enough alone.
 */
export function installTouchGuards(target: Document = document): () => void {
  if (typeof window === 'undefined' || !window.matchMedia('(pointer: coarse)').matches) {
    return () => undefined;
  }
  const onContextMenu = (event: Event) => {
    if (event.target instanceof Element && event.target.closest(KEEPS_MENU) !== null) return;
    event.preventDefault();
  };
  target.addEventListener('contextmenu', onContextMenu);
  return () => target.removeEventListener('contextmenu', onContextMenu);
}
