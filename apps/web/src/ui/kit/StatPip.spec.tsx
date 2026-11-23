import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatPip } from './StatPip';

const ICON = <svg data-testid="icon" />;
const THRUST = 'Thrust';

describe('StatPip', () => {
  it('shows an up arrow with the difference and reads value and change', () => {
    render(<StatPip icon={ICON} value={25} compare={7} label={THRUST} />);
    expect(screen.getByText(/▲\s*7/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Thrust: 25, up 7' })).toBeInTheDocument();
  });

  it('shows a down arrow with the difference as a positive number', () => {
    render(<StatPip icon={ICON} value={40} compare={-5} label={THRUST} />);
    expect(screen.getByText(/▼\s*5/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Thrust: 40, down 5' })).toBeInTheDocument();
  });

  it('shows no arrow without a comparison or with no change', () => {
    const { rerender } = render(<StatPip icon={ICON} value={25} label={THRUST} />);
    expect(screen.queryByText(/[▲▼]/)).toBeNull();
    expect(screen.getByRole('img', { name: 'Thrust: 25' })).toBeInTheDocument();
    rerender(<StatPip icon={ICON} value={25} compare={0} label={THRUST} />);
    expect(screen.queryByText(/[▲▼]/)).toBeNull();
  });
});
