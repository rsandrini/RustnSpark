import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Reads a guide's lines to the end: the first press finishes the typing, the next goes on. */
export async function dismissGuide() {
  for (let guard = 0; guard < 12; guard += 1) {
    const box = screen.queryByTestId('dialogue');
    if (box === null) return;
    await userEvent.click(within(box).getAllByRole('button')[0] as HTMLElement);
  }
}
