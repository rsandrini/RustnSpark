import type { KeyboardEvent } from 'react';

/**
 * Keyboard support for a `role="tablist"`: Left and Right (and Up and Down) move to the neighbouring tab, Home and
 * End to the first and last, and the tab that receives focus is activated (automatic activation, as the tabs
 * here only switch a view). Put it on the tablist; give each tab `tabIndex={selected ? 0 : -1}` so the list is a
 * single stop in the tab order.
 */
export function tablistKeys(event: KeyboardEvent<HTMLElement>): void {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])'),
  );
  const current = tabs.findIndex((tab) => tab === document.activeElement);
  if (tabs.length === 0 || current === -1) return;
  let next: number;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tabs.length - 1;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
    next = (current - 1 + tabs.length) % tabs.length;
  else next = (current + 1) % tabs.length;
  event.preventDefault();
  const target = tabs[next];
  if (target === undefined) return;
  target.focus();
  target.click();
}
