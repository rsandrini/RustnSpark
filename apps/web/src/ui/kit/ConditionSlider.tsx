import type { CSSProperties } from 'react';

const ARROW = '→';

export interface ConditionSliderProps {
  /** Where the part is now: the filled part of the track, with a tick. */
  current: number;
  /** The chosen target: where the thumb sits. */
  value: number;
  max?: number;
  /** Lowest value the thumb can reach (default: `current`). */
  min?: number;
  onChange: (value: number) => void;
  /** The accessible name of the range input. */
  label: string;
  tone?: 'ok' | 'warn' | 'bad' | 'fuel';
  disabled?: boolean;
  /** How a number reads in the captions (default `62%`). */
  format?: (value: number) => string;
  step?: number;
  ariaValueText?: string;
  /** Id of the range input (so a visible label can point at it). */
  id?: string;
}

// One control to read a level and to drag its target: a track filled to the current value, a hatched
// segment from there to the target (what will be added) and a real range input layered over it, so
// keyboard, touch and assistive tech come with the browser.
export function ConditionSlider({
  current,
  value,
  max = 100,
  min = current,
  onChange,
  label,
  tone = 'ok',
  disabled = false,
  format = (amount) => `${amount}%`,
  step = 1,
  ariaValueText,
  id,
}: ConditionSliderProps) {
  const pct = (amount: number) => (max <= 0 ? 0 : Math.min(100, Math.max(0, (amount / max) * 100)));
  const now = pct(current);
  const to = Math.max(now, pct(value));
  const from = pct(min);
  return (
    <div className={`cslider ${tone}${disabled ? ' disabled' : ''}`} data-testid="condition-slider">
      <div className="cslider-track">
        <div className="cslider-fill" data-testid="cslider-fill" style={{ width: `${now}%` }} />
        <div
          className="cslider-add"
          data-testid="cslider-add"
          style={{ left: `${now}%`, width: `${to - now}%` }}
        />
        <div className="cslider-tick" aria-hidden="true" style={{ left: `${now}%` }} />
        <input
          id={id}
          type="range"
          className="cslider-input"
          style={{ '--from': `${from}%` } as CSSProperties}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          aria-valuetext={ariaValueText}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
      <div className="cslider-caps" aria-hidden="true">
        <span>{format(current)}</span>
        {value > current && <span>{[ARROW, format(value)].join(' ')}</span>}
      </div>
    </div>
  );
}
