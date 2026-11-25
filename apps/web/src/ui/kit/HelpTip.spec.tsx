import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HelpTip } from './HelpTip';

const TEXT = 'Move a slider to choose how far to repair.';

describe('HelpTip', () => {
  it('renders a button named by the label, or by the shared Help label', () => {
    const { unmount } = render(<HelpTip label="About repair">{TEXT}</HelpTip>);
    expect(screen.getByRole('button', { name: 'About repair' })).toBeInTheDocument();
    unmount();
    render(<HelpTip>{TEXT}</HelpTip>);
    expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
  });

  it('shows the text on focus and on hover, described through aria-describedby', () => {
    render(<HelpTip>{TEXT}</HelpTip>);
    const button = screen.getByRole('button', { name: 'Help' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focus(button);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent(TEXT);
    expect(button.getAttribute('aria-describedby')).toBe(tip.id);

    fireEvent.blur(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent(TEXT);
  });

  it('toggles on tap: the second tap closes it', () => {
    render(<HelpTip>{TEXT}</HelpTip>);
    const button = screen.getByRole('button', { name: 'Help' });
    fireEvent.click(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent(TEXT);
    fireEvent.click(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<HelpTip>{TEXT}</HelpTip>);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
