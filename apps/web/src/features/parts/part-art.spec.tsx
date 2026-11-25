import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PartArt } from './part-art';

describe('PartArt', () => {
  it('renders the kind icon with the rarity class and no text', () => {
    const { container } = render(
      <PartArt
        catalog={{ partType: 'engine_rare', partClass: 'ENGINE' }}
        rarity="RARE"
        size={40}
      />,
    );
    const tile = container.querySelector('[data-testid="part-art"]');
    expect(tile).toHaveClass('rarity-rare', 'part-art-40');
    expect(tile?.querySelectorAll('svg path').length).toBeGreaterThan(0);
    expect(tile?.textContent).toBe('');
  });

  it('defaults to the card size', () => {
    const { container } = render(
      <PartArt catalog={{ partType: 'cargo', partClass: 'CARGO' }} rarity="COMMON" />,
    );
    expect(container.querySelector('.part-art')).toHaveClass('part-art-72');
  });
});
