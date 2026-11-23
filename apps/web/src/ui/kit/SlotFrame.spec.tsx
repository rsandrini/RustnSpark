import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlotFrame } from './SlotFrame';

const PART = 'part';

describe('SlotFrame', () => {
  it('applies the rarity class and shows its children', () => {
    const { container } = render(
      <SlotFrame rarity="rare">
        <span>{PART}</span>
      </SlotFrame>,
    );
    expect(container.firstElementChild).toHaveClass('kit-slot', 'kit-slot--rare');
    expect(screen.getByText(PART)).toBeInTheDocument();
  });

  it('defaults to common and is dashed when empty', () => {
    const { container, rerender } = render(<SlotFrame />);
    expect(container.firstElementChild).toHaveClass('kit-slot--common');
    expect(container.firstElementChild).not.toHaveClass('kit-slot--empty');
    rerender(<SlotFrame empty />);
    expect(container.firstElementChild).toHaveClass('kit-slot--empty');
  });
});
