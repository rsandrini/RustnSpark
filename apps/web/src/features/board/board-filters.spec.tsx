import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { BoardFilters, type BoardFiltersProps } from './board-filters';

function setup(over: Partial<BoardFiltersProps> = {}) {
  const props: BoardFiltersProps = {
    type: 'all',
    onType: vi.fn(),
    counts: { DELIVERY: 2, MINING: 1 },
    onlyEligible: true,
    onOnlyEligible: vi.fn(),
    sort: 'reward',
    onSort: vi.fn(),
    showEligibleToggle: true,
    ...over,
  };
  renderWithProviders(<BoardFilters {...props} />);
  return props;
}

describe('BoardFilters', () => {
  it('has All plus one tab per kind on the shelf, each with its count, and none for an empty kind', () => {
    setup();
    expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-label'))).toEqual([
      'All missions (3)',
      'Delivery (2)',
      'Mining (1)',
    ]);
  });

  it('counts a kind outside the tab order under All, without giving it a tab', () => {
    setup({ counts: { DELIVERY: 1, TRAVEL: 2 } });
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'All missions (3)' })).toBeInTheDocument();
  });

  it('keeps the selected kind visible with a zero count', () => {
    setup({ type: 'RACE', counts: { DELIVERY: 1 } });
    expect(screen.getByRole('tab', { name: 'Race (0)' })).toHaveAttribute('aria-selected', 'true');
  });

  it('selecting a tab reports the kind', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Mining (1)' }));
    expect(props.onType).toHaveBeenCalledWith('MINING');
  });

  it('shows the toggle and reports it; hides it in the opening', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Only eligible' }));
    expect(props.onOnlyEligible).toHaveBeenCalledWith(false);
  });

  it('has no toggle when it is not shown', () => {
    setup({ showEligibleToggle: false });
    expect(screen.queryByRole('button', { name: 'Only eligible' })).toBeNull();
  });

  it('reports the sort', () => {
    const props = setup();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'risk' } });
    expect(props.onSort).toHaveBeenCalledWith('risk');
  });
});
