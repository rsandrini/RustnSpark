import { describe, it, expect } from 'vitest';
import { labelLines } from './ship-yard';

describe('labelLines', () => {
  it('cuts a long name to one short line on a single cell at the default zoom', () => {
    const lines = labelLines('Small Chemical Engine', 1, 1, 1);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.length).toBeLessThanOrEqual(3);
  });

  it('shows the whole name on more lines once the player zooms in', () => {
    const lines = labelLines('Small Chemical Engine', 1, 1, 3);
    expect(lines.join(' ')).toBe('Small Chemical Engine');
    expect(lines.length).toBeGreaterThan(1);
  });

  it('fits a wide block on a single line', () => {
    expect(labelLines('Hull Frame', 4, 1, 1)).toEqual(['Hull Frame']);
  });
});
