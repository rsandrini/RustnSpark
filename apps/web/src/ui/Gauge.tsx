export interface GaugeProps {
  value: number;
  max: number;
  /** Optional planned value (e.g. the repair target): drawn as a lighter segment past `value`. */
  planned?: number;
  /** What `value` would drop to after some action (e.g. a mission's fuel cost): the amount that
      would be spent — `value - remainingAfter` — is drawn as a highlighted segment carved out of
      the current fill itself, never past it, so the bar reads as "this much of what you have now
      would go". Clamped to the current fill (can't show spending more than there is). */
  remainingAfter?: number;
  /** Text inside the bar. */
  label: string;
  ariaLabel: string;
  tone?: 'ok' | 'warn' | 'bad' | 'fuel';
}

// A horizontal bar with its number on it. Presentation only: the caller decides the tone.
export function Gauge({ value, max, planned, remainingAfter, label, ariaLabel, tone = 'ok' }: GaugeProps) {
  const pct = (amount: number) =>
    max <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((amount / max) * 100)));
  const spend =
    remainingAfter === undefined
      ? 0
      : Math.max(0, Math.min(value, value - Math.max(0, remainingAfter)));
  const remain = value - spend;
  return (
    <div
      className={`gauge ${tone}`}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      {planned !== undefined && planned > value && (
        <div className="gauge-planned" style={{ width: `${pct(planned)}%` }} />
      )}
      <div className="gauge-fill" style={{ width: `${pct(remain)}%` }} />
      {spend > 0 && (
        <div
          className="gauge-consume"
          style={{ left: `${pct(remain)}%`, width: `${pct(value) - pct(remain)}%` }}
        />
      )}
      <span className="gauge-label">{label}</span>
    </div>
  );
}

/** Condition colour bands (percent): purely visual; the server owns what condition means. */
export function conditionTone(condition: number): 'ok' | 'warn' | 'bad' {
  if (condition >= 70) return 'ok';
  if (condition >= 40) return 'warn';
  return 'bad';
}
