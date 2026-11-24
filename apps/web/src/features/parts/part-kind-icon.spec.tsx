import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PartKindIcon } from './part-kind-icon';
import { PART_KIND_ORDER } from './part-kind';

describe('PartKindIcon', () => {
  for (const kind of PART_KIND_ORDER) {
    it(`${kind} renders an aria-hidden svg`, () => {
      const { container } = render(<PartKindIcon kind={kind} />);
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.querySelectorAll('path').length).toBeGreaterThan(0);
    });
  }

  it('other renders the generic fallback and size applies', () => {
    const { container } = render(<PartKindIcon kind="other" size={14} />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('14');
  });
});
