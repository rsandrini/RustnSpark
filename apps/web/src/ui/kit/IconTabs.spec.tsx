import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { IconTabs } from './IconTabs';

const TABS = [
  { id: 'a', icon: <svg />, label: 'Engines' },
  { id: 'b', icon: <svg />, label: 'Shields' },
  { id: 'c', icon: <svg />, label: 'Cargo' },
];

describe('IconTabs', () => {
  it('is a tablist of named tabs with the value selected', () => {
    render(<IconTabs tabs={TABS} value="b" onChange={() => undefined} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Shields' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Engines' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Engines' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves the selection with the arrow keys and calls onChange', () => {
    const onChange = vi.fn();
    render(<IconTabs tabs={TABS} value="a" onChange={onChange} />);
    screen.getByRole('tab', { name: 'Engines' }).focus();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('b');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith('c');
  });

  it('shows the label as a tooltip on focus', () => {
    render(<IconTabs tabs={TABS} value="a" onChange={() => undefined} />);
    fireEvent.focus(screen.getByRole('tab', { name: 'Cargo' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Cargo');
  });

  it('the tab name is not read twice: no aria-describedby on the tab', () => {
    render(<IconTabs tabs={TABS} value="a" onChange={() => undefined} />);
    const tab = screen.getByRole('tab', { name: 'Cargo' });
    fireEvent.focus(tab);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(tab).not.toHaveAttribute('aria-describedby');
  });
});
