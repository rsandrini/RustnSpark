import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { PartFilterBar } from './part-filter-bar';

describe('PartFilterBar', () => {
  it('searches by name and picks a type, search first then the tabs', () => {
    const onSearch = vi.fn();
    const onGroup = vi.fn();
    renderWithProviders(
      <PartFilterBar
        groups={['ENGINE', 'WEAPON_LASER']}
        group={null}
        onGroup={onGroup}
        search=""
        onSearch={onSearch}
      />,
    );
    const bar = screen.getByRole('search');
    expect(bar).toHaveClass('part-filter-bar');
    expect(bar.children[0]).toBe(screen.getByRole('searchbox'));
    expect(bar.children[1]).toContainElement(screen.getByRole('tablist'));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'mot' } });
    expect(onSearch).toHaveBeenCalledWith('mot');
    fireEvent.click(screen.getByRole('tab', { name: 'Engine' }));
    expect(onGroup).toHaveBeenCalledWith('ENGINE');
  });
});
