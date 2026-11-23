import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface ResourceChipProps {
  icon?: ReactNode;
  label: string;
  value: number;
  unit?: string;
  testId?: string;
  /** Accessible name of the whole chip (for a compact icon + number row where the label is not shown). */
  ariaLabel?: string;
  /** The label is visually hidden but stays available to assistive tech. */
  hideLabel?: boolean;
  /** Pass-through to the root so a Tooltip can describe the chip. */
  'aria-describedby'?: string;
  /** Pass-through to the root; set 0 to make the chip focusable (default: none). */
  tabIndex?: number;
}

/** The count runs in this many steps over about COUNT_MS; the flash lasts FLASH_MS. */
const COUNT_MS = 600;
const STEP_MS = 30;
const FLASH_MS = 900;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * A resource in the HUD (credits, scrap...): icon, label and number. When the number changes it counts to the new
 * value over about 600 ms and flashes green on a rise, red on a fall (the arrow in the class name is not the only
 * signal: the number itself moves). With reduced motion it only shows the value.
 */
export function ResourceChip({
  icon,
  label,
  value,
  unit,
  testId,
  ariaLabel,
  hideLabel = false,
  'aria-describedby': describedBy,
  tabIndex,
}: ResourceChipProps) {
  const { i18n } = useTranslation();
  const [shown, setShown] = useState(value);
  const [flash, setFlash] = useState<'rise' | 'fall' | null>(null);
  const last = useRef(value);
  const current = useRef(value);

  useEffect(() => {
    const from = last.current;
    last.current = value;
    if (from === value) return undefined;
    if (prefersReducedMotion()) {
      current.current = value;
      setShown(value);
      return undefined;
    }
    setFlash(value > from ? 'rise' : 'fall');
    const start = current.current;
    const steps = Math.round(COUNT_MS / STEP_MS);
    let step = 0;
    const counter = window.setInterval(() => {
      step += 1;
      const next = step >= steps ? value : Math.round(start + ((value - start) * step) / steps);
      current.current = next;
      setShown(next);
      if (step >= steps) window.clearInterval(counter);
    }, STEP_MS);
    const flasher = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => {
      window.clearInterval(counter);
      window.clearTimeout(flasher);
    };
  }, [value]);

  const text = new Intl.NumberFormat(i18n.language).format(shown);
  return (
    <span
      className={`kit-chip${flash === null ? '' : ` kit-chip--${flash}`}`}
      data-testid={testId}
      role={ariaLabel === undefined ? undefined : 'group'}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      tabIndex={tabIndex}
    >
      {icon !== undefined && (
        <span className="kit-chip-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={`kit-chip-label${hideLabel ? ' sr-only' : ''}`}>{label}</span>
      <span className="kit-chip-value">{unit === undefined ? text : `${text} ${unit}`}</span>
    </span>
  );
}
