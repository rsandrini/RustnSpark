export interface RiskPipsProps {
  level: 0 | 1 | 2 | 3;
  /** The risk in words ("Medium risk"): the pips are never the only signal. */
  label: string;
}

const PIPS = [1, 2, 3];

/** Three pips filled up to the risk level (clamped to 0..3), tinted low / medium / high. */
export function RiskPips({ level, label }: RiskPipsProps) {
  const filled = Math.min(3, Math.max(0, Math.round(level)));
  const tone = filled >= 3 ? 'hi' : filled === 2 ? 'md' : 'lo';
  return (
    <span className={`kit-pips kit-pips--${tone}`} role="img" aria-label={label}>
      {PIPS.map((n) => (
        <i key={n} className={`kit-pip${n <= filled ? ' on' : ''}`} />
      ))}
    </span>
  );
}
