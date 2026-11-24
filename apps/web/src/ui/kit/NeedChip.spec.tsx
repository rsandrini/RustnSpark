import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NeedChip } from './NeedChip';

describe('NeedChip (advice, amber: not the red BlockerChip)', () => {
  it('the whole chip is the button that calls onShow', async () => {
    const onShow = vi.fn();
    render(<NeedChip label="No weapon" onShow={onShow} />);
    await userEvent.click(screen.getByRole('button', { name: 'No weapon' }));
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.kit-blocker')).toBeNull();
  });

  it('has a plus icon by default and takes another icon', () => {
    const { rerender } = render(<NeedChip label="A" onShow={() => {}} />);
    expect(document.querySelector('.kit-need-main svg path')).toHaveAttribute(
      'd',
      'M12 5v14M5 12h14',
    );
    rerender(<NeedChip label="A" icon={<i data-testid="ic" />} onShow={() => {}} />);
    expect(screen.getByTestId('ic')).toBeInTheDocument();
  });

  it('the dismiss mark is its own button and does not call onShow', async () => {
    const onShow = vi.fn();
    const onDismiss = vi.fn();
    render(<NeedChip label="A" onShow={onShow} onDismiss={onDismiss} dismissLabel="Dismiss A" />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss A' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onShow).not.toHaveBeenCalled();
  });

  it('has no dismiss mark without onDismiss', () => {
    render(<NeedChip label="A" onShow={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
