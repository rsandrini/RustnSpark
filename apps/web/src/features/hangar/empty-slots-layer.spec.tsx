import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { EmptySlotsLayer } from './empty-slots-layer';

const hints = [
  { needId: 'weapon', x: 1, y: 0, side: 'E' as const },
  { needId: 'shield', x: 0, y: 1, side: 'S' as const },
];

function mount(onPick = vi.fn()) {
  renderWithProviders(
    <svg>
      <EmptySlotsLayer hints={hints} onPick={onPick} />
    </svg>,
  );
  return onPick;
}

describe('EmptySlotsLayer', () => {
  it('renders one named, focusable dashed slot per hint', () => {
    mount();
    const slots = screen.getAllByRole('button');
    expect(slots).toHaveLength(2);
    expect(slots[0]).toHaveAccessibleName('Add weapon here');
    expect(slots[1]).toHaveAccessibleName('Add shield here');
    expect(slots[0]).toHaveAttribute('tabindex', '0');
    expect(slots[0]?.querySelector('.yard-slot-box')).not.toBeNull();
  });

  it('calls onPick with the need id on click, Enter and Space', () => {
    const onPick = mount();
    const [first, second] = screen.getAllByRole('button');
    fireEvent.click(first as Element);
    fireEvent.keyDown(second as Element, { key: 'Enter' });
    fireEvent.keyDown(first as Element, { key: ' ' });
    expect(onPick.mock.calls).toEqual([['weapon'], ['shield'], ['weapon']]);
  });

  it('lets pointers through except on the slots themselves', () => {
    const { container } = renderWithProviders(
      <svg>
        <EmptySlotsLayer hints={hints} onPick={vi.fn()} />
      </svg>,
    );
    expect(container.querySelector('.yard-slots')).toHaveStyle({ pointerEvents: 'none' });
    for (const slot of container.querySelectorAll('.yard-slot')) {
      expect(slot).toHaveStyle({ pointerEvents: 'all' });
    }
  });
});
