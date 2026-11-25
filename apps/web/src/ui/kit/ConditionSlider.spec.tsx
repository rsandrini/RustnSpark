import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConditionSlider } from './ConditionSlider';

const LABEL = 'Hull repair';
const props = { current: 62, value: 90, label: LABEL, onChange: () => undefined };

describe('ConditionSlider', () => {
  it('is one range input from the current value to 100 sitting at the target', () => {
    const { container } = render(<ConditionSlider {...props} />);
    expect(container.querySelectorAll('input[type=range]')).toHaveLength(1);
    const input = screen.getByRole<HTMLInputElement>('slider', { name: LABEL });
    expect(input.min).toBe('62');
    expect(input.max).toBe('100');
    expect(input.value).toBe('90');
  });

  it('draws the current fill and a segment proportional to the difference', () => {
    render(<ConditionSlider {...props} />);
    expect(screen.getByTestId('cslider-fill').style.width).toBe('62%');
    const add = screen.getByTestId('cslider-add');
    expect(add.style.left).toBe('62%');
    expect(add.style.width).toBe('28%');
  });

  it('shows now and to captions, and no target caption when nothing is added', () => {
    const { rerender } = render(<ConditionSlider {...props} />);
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText('→ 90%')).toBeInTheDocument();
    rerender(<ConditionSlider {...props} value={62} format={(v) => `now ${v}`} />);
    expect(screen.getByText('now 62')).toBeInTheDocument();
    expect(screen.queryByText(/→/)).toBeNull();
  });

  it('reports changes from the input and keeps the value within [current, max]', () => {
    const onChange = vi.fn();
    render(<ConditionSlider {...props} onChange={onChange} />);
    const input = screen.getByRole<HTMLInputElement>('slider');
    fireEvent.change(input, { target: { value: '95' } });
    expect(onChange).toHaveBeenLastCalledWith(95);
    // the browser clamps a range input to its min and max
    fireEvent.change(input, { target: { value: '10' } });
    expect(onChange).toHaveBeenLastCalledWith(62);
    fireEvent.change(input, { target: { value: '500' } });
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it('works for a destroyed part (current 0)', () => {
    render(<ConditionSlider {...props} current={0} value={40} />);
    const input = screen.getByRole<HTMLInputElement>('slider');
    expect(input.min).toBe('0');
    expect(screen.getByTestId('cslider-fill').style.width).toBe('0%');
    expect(screen.getByTestId('cslider-add').style.width).toBe('40%');
  });

  it('can be disabled', () => {
    render(<ConditionSlider {...props} disabled />);
    expect(screen.getByRole('slider')).toBeDisabled();
  });
});
