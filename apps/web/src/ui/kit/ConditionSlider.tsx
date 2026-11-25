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
//
// Geometry. The input spans from L = from% of the track to its right edge (width W - L). A native
// thumb of border-box width T has its centre travel from L + T/2 to W - T/2, so for a value with
// fraction f = (value - min) / (max - min) the centre sits at
//   x(f) = L + T/2 + (W - L - T) * f
// The fill ends at x(fNow), the hatched segment runs x(fNow)..x(fTo) and the tick sits at x(fNow),
// so the thumb lies exactly on them. CSS builds x from the custom properties --from, --now, --to
// (see kit.css, `--thumb` = T); `thumbCentre` is the same formula in pixels, for the spec.
export function thumbCentre(fromPct: number, fraction: number, thumb: number, width: number) {
  const left = (width * fromPct) / 100;
  return left + thumb / 2 + (width - left - thumb) * fraction;
}

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
  const fraction = (amount: number) =>
    max <= min ? 0 : Math.min(1, Math.max(0, (amount - min) / (max - min)));
  const now = fraction(current);
  const to = Math.max(now, fraction(value));
  const from = `${pct(min)}%`;
  return (
    <div className={`cslider ${tone}${disabled ? ' disabled' : ''}`} data-testid="condition-slider">
      <div
        className="cslider-track"
        style={{ '--from': from, '--now': now, '--to': to } as CSSProperties}
      >
        <div className="cslider-fill" data-testid="cslider-fill" />
        <div className="cslider-add" data-testid="cslider-add" />
        <div className="cslider-tick" aria-hidden="true" />
        <input
          id={id}
          type="range"
          className="cslider-input"
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
