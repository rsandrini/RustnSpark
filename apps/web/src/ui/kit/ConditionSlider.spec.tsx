import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('has a focus ring on the track (not clipped) and a thumb ring', () => {
    const css = readFileSync(join(__dirname, '../../styles/kit.css'), 'utf8');
    expect(css).toMatch(/\.cslider-track:focus-within\s*\{[^}]*outline:\s*2px solid/);
    expect(css).toMatch(/\.cslider-input:focus-visible::-webkit-slider-thumb\s*\{[^}]*box-shadow/);
  });

  it('clamps the usable span so a part at 99.5% keeps a non-negative width', () => {
    const css = readFileSync(join(__dirname, '../../styles/kit.css'), 'utf8');
    expect(css).toMatch(/--span:\s*max\(0px,/);
    render(<ConditionSlider {...props} current={99.5} value={99.5} />);
    expect(screen.getByRole<HTMLInputElement>('slider').min).toBe('99.5');
  });

  describe('repair and refuel bar styling', () => {
    const kit = readFileSync(join(__dirname, '../../styles/kit.css'), 'utf8');
    const rule = (css: string, sel: string) => {
      const m = css.match(
        new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'),
      );
      return m?.[1] ?? '';
    };

    it('has a 16px round thumb', () => {
      expect(kit).toMatch(/--thumb:\s*16px/);
      for (const sel of [
        '.cslider-input::-webkit-slider-thumb',
        '.cslider-input::-moz-range-thumb',
      ]) {
        const body = rule(kit, sel);
        expect(body).toMatch(/border-radius:\s*50%/);
        expect(body).toMatch(/height:\s*16px/);
      }
    });

    it('paints the target segment solid info, not hatched', () => {
      const body = kit.match(/\n\.cslider-add\s*\{([^}]*left:\s*var\(--x-now\)[^}]*)\}/)?.[1] ?? '';
      expect(body).toMatch(/background:\s*var\(--info\)/);
      expect(body).not.toMatch(/repeating-linear-gradient/);
      expect(kit).not.toMatch(/\.cslider\.fuel \.cslider-add/);
      expect(rule(kit, '.cslider.fuel .cslider-fill')).toMatch(/var\(--ok\)/);
      // the default fill uses a colour the theme really defines (an undefined token left the bar black)
      expect(rule(kit, '.cslider-fill')).toMatch(/background:\s*var\(--ok\)/);
      expect(kit).not.toMatch(/var\(--good\)/);
    });

    it('animates fill and target only when motion is allowed', () => {
      const m = kit.match(
        /@media \(prefers-reduced-motion: no-preference\) \{(?:[^{}]|\{[^}]*\})*?\.cslider-fill(?:[^{}]|\{[^}]*\})*\}/,
      );
      expect(m).not.toBeNull();
      const block = m![0];
      expect(block).toMatch(/\.cslider-add/);
      expect(block).toMatch(
        /transition:[^;]*width[^;]*left[^;]*1s|transition:[^;]*left[^;]*width[^;]*1s/,
      );
    });

    it('drops the transition while the thumb is held, inside the motion block', () => {
      expect(kit).toMatch(
        /prefers-reduced-motion: no-preference\) \{(?:[^{}]|\{[^}]*\})*\.cslider:has\(\.cslider-input:active\) :is\(\.cslider-fill, \.cslider-add\)\s*\{[^}]*transition:\s*none/,
      );
    });

    it('keeps the thumb on the fill edge at fuel 40% and at 0', () => {
      expect(thumbCentre(40, 0, 16, 300)).toBe(128);
      expect(thumbCentre(0, 1, 16, 300)).toBe(292);
    });

    it('does not override the range width in the refuel panel', () => {
      const port = readFileSync(join(__dirname, '../../styles/port.css'), 'utf8');
      expect(rule(port, ".refuel-panel input[type='range']")).not.toMatch(/width/);
    });
  });
});
