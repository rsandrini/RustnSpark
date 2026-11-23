import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RiskPips } from './RiskPips';

const LABEL = 'Medium risk';

function filled() {
  return screen.getByRole('img', { name: LABEL }).querySelectorAll('.kit-pip.on').length;
}

describe('RiskPips', () => {
  it('is an image named by the label with three pips', () => {
    render(<RiskPips level={2} label={LABEL} />);
    expect(screen.getByRole('img', { name: LABEL }).querySelectorAll('.kit-pip')).toHaveLength(3);
  });

  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [7, 3],
    [-2, 0],
  ])('level %i fills %i pips (clamped)', (level, count) => {
    render(<RiskPips level={level as 0} label={LABEL} />);
    expect(filled()).toBe(count);
  });
});
