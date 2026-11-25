import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConditionSlider, thumbCentre } from './ConditionSlider';

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

  it('hands the track the fractions its fill, segment, tick and thumb are placed from', () => {
    render(<ConditionSlider {...props} />);
    const track = screen.getByTestId('cslider-fill').parentElement!;
    // current 62, value 90, max 100: the input starts at 62%; now is its start, to is (90-62)/38
    expect(track.style.getPropertyValue('--from')).toBe('62%');
    expect(track.style.getPropertyValue('--now')).toBe('0');
    expect(Number(track.style.getPropertyValue('--to'))).toBeCloseTo(28 / 38, 10);
  });

  it('places a value in a refuel bar (current 25, value 30, max 120)', () => {
    render(<ConditionSlider current={25} value={30} max={120} label="Fuel" onChange={() => 0} />);
    const track = screen.getByTestId('cslider-fill').parentElement!;
    expect(Number(track.style.getPropertyValue('--from').replace('%', ''))).toBeCloseTo(
      (25 / 120) * 100,
      10,
    );
    expect(track.style.getPropertyValue('--now')).toBe('0');
    expect(Number(track.style.getPropertyValue('--to'))).toBeCloseTo(5 / 95, 10);
  });

  it('keeps the segment empty and the fractions finite when nothing can be added', () => {
    render(<ConditionSlider {...props} current={100} value={100} />);
    const track = screen.getByTestId('cslider-fill').parentElement!;
    expect(track.style.getPropertyValue('--to')).toBe('0');
  });

  it('puts the thumb centre on the tick at the minimum and on the segment end at the maximum', () => {
    // W = 300, T = 12, input from 62%: at f = 0 the centre is at the tick, at f = 1 at W - T/2
    expect(thumbCentre(62, 0, 12, 300)).toBeCloseTo(186 + 6, 10);
    expect(thumbCentre(62, 1, 12, 300)).toBeCloseTo(294, 10);
    expect(thumbCentre(0, 0.5, 12, 300)).toBeCloseTo(150, 10);
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
    const track = screen.getByTestId('cslider-fill').parentElement!;
    expect(track.style.getPropertyValue('--from')).toBe('0%');
    expect(track.style.getPropertyValue('--now')).toBe('0');
    expect(track.style.getPropertyValue('--to')).toBe('0.4');
  });

  it('can be disabled', () => {
    render(<ConditionSlider {...props} disabled />);
    expect(screen.getByRole('slider')).toBeDisabled();
  });
});
