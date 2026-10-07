import { describe, it, expect } from 'vitest';
import { labelAreaFactor, labelLines } from './ship-yard';

describe('labelAreaFactor', () => {
  it('is 1 at and below the classic_square baseline (20×20 = 400 cells) — never scales up', () => {
    expect(labelAreaFactor(400)).toBe(1);
    expect(labelAreaFactor(25)).toBe(1);
    expect(labelAreaFactor(1)).toBe(1);
  });

  it('shrinks the label on a larger yard', () => {
    expect(labelAreaFactor(961)).toBeLessThan(1); // 31×31
  });

  it('clamps extreme formats', () => {
    expect(labelAreaFactor(100000)).toBe(0.5); // min shrink
  });
});

describe('labelLines', () => {
  it('wraps the name into block-sized lines on a single cell at the default zoom', () => {
    const lines = labelLines('Small Chemical Engine', 1, 1, 1);
    expect(lines.join(' ')).toBe('Small Chemical Engine');
    expect(lines.length).toBeGreaterThan(0);
    // Capacity at the current font: floor(0.85 * 4.3 * 0.42 / 0.16) = 9 chars per line.
    expect(lines.every((line) => line.length <= 9)).toBe(true);
  });

  it('fits the whole name on one line once the player zooms in', () => {
    const lines = labelLines('Small Chemical Engine', 1, 1, 3);
    expect(lines.join(' ')).toBe('Small Chemical Engine');
    expect(lines).toHaveLength(1);
  });

  it('fits a wide block on a single line', () => {
    expect(labelLines('Hull Frame', 4, 1, 1)).toEqual(['Hull Frame']);
  });

  it('fits more of the name when the yard area shrinks the font (areaFactor < 1)', () => {
    const atBaseline = labelLines('Small Chemical Engine', 1, 1, 1, 1);
    const onBigYard = labelLines('Small Chemical Engine', 1, 1, 1, 0.65);
    expect(onBigYard.join(' ').length).toBeGreaterThanOrEqual(atBaseline.join(' ').length);
  });
});
