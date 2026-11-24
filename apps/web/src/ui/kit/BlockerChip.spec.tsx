import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { BlockerChip } from './BlockerChip';

const LABEL = 'No engine';
const SHIP = 'Ship screen';

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

  it('navigates in the app, without a page load, when it has a to', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/board']}>
        <Routes>
          <Route path="/board" element={<BlockerChip label={LABEL} to="/ship?store=CARGO" />} />
          <Route path="/ship" element={<p>{SHIP}</p>} />
        </Routes>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: LABEL });
    expect(link).toHaveAttribute('href', '/ship?store=CARGO');
    await user.click(link);
    expect(screen.getByText(SHIP)).toBeInTheDocument();
  });

  it('carries a test id and a state on the chip', () => {
    render(<BlockerChip label={LABEL} testId="fuel-chip" state="short" className="fuel-chip" />);
    expect(screen.getByTestId('fuel-chip')).toHaveAttribute('data-state', 'short');
    expect(screen.getByTestId('fuel-chip')).toHaveClass('kit-blocker', 'fuel-chip');
  });
});
