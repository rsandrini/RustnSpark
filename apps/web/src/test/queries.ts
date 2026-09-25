import { screen } from '@testing-library/react';

/** `queryByRole` that treats several matches as "present" instead of throwing. */
export function queryByRoleSafe(role: string): HTMLElement | null {
  const found = screen.queryAllByRole(role);
  return found.length > 0 ? (found[0] ?? null) : null;
}
