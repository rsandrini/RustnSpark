import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlockerChip } from './BlockerChip';

const LABEL = 'No engine';

describe('BlockerChip', () => {
  it('calls onFix on click, Enter and Space', async () => {
    const onFix = vi.fn();
    const user = userEvent.setup();
    render(<BlockerChip label={LABEL} onFix={onFix} />);
    const chip = screen.getByRole('button', { name: LABEL });
    await user.click(chip);
    chip.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onFix).toHaveBeenCalledTimes(3);
  });

  it('is a link when it has an href', () => {
    render(<BlockerChip label={LABEL} href="/ship" />);
    expect(screen.getByRole('link', { name: LABEL })).toHaveAttribute('href', '/ship');
  });

  it('is a plain chip with nothing to fix', () => {
    render(<BlockerChip label={LABEL} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(LABEL)).toBeInTheDocument();
    fireEvent.click(screen.getByText(LABEL));
  });
});
