import { useEffect } from 'react';

/** What the pilot can press or drag on the real screens. Each one outside the step's allowed parts is made inert. */
const CONTROLS =
  'button, a[href], input, select, textarea, summary, [role="tab"], [role="button"], [role="switch"], [draggable="true"], .hangar-scene';

/** Always alive: the story's own boxes and bar, the account menu (language, Sign out), and any popup the real screens open. The HUD only opens read-only cards and the ship-fault chips lead to the Ship screen, as the old notice did. */
const FREE =
  '[data-dialogue], [data-opening-free], [role="dialog"], [role="alertdialog"], .shell-top .brand, .shell-account, .toast, .notice, .hud, .board-faults';

const LOCKED = 'data-opening-locked';
const ALLOWED = 'data-opening-allowed';

/**
 * Locks the real screens while a step runs: everything the pilot could press is inert (it cannot be clicked, focused or
 * dragged) and dimmed, except the parts the step allows, which are marked so they can glow. The screens re-render all the
 * time, so it looks again whenever the page changes. It undoes itself when the step ends.
 */
export function useOpeningLocks(allow: readonly string[], enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined;
    const selector = allow.join(',');
    const sweep = () => {
      const allowed = selector === '' ? [] : Array.from(document.querySelectorAll(selector));
      for (const el of allowed) el.setAttribute(ALLOWED, '');
      for (const el of Array.from(document.querySelectorAll(CONTROLS))) {
        const free = allowed.some((zone) => zone.contains(el)) || el.closest(FREE) !== null;
        if (free) {
          if (el.hasAttribute(LOCKED)) {
            el.removeAttribute(LOCKED);
            el.removeAttribute('inert');
          }
        } else if (!el.hasAttribute(LOCKED)) {
          el.setAttribute(LOCKED, '');
          el.setAttribute('inert', '');
        }
      }
    };
    let frame = 0;
    const later = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(sweep);
    };
    sweep();
    const observer = new MutationObserver(later);
    // only the page's structure: the attributes this sets must not wake it again
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      for (const el of Array.from(document.querySelectorAll(`[${LOCKED}]`))) {
        el.removeAttribute(LOCKED);
        el.removeAttribute('inert');
      }
      for (const el of Array.from(document.querySelectorAll(`[${ALLOWED}]`))) {
        el.removeAttribute(ALLOWED);
      }
    };
  }, [allow, enabled]);
}
