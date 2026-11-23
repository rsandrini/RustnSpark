import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface ResourceChipProps {
  icon?: ReactNode;
  label: string;
  value: number;
  unit?: string;
  testId?: string;
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
export function ResourceChip({ icon, label, value, unit, testId }: ResourceChipProps) {
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
    <span className={`kit-chip${flash === null ? '' : ` kit-chip--${flash}`}`} data-testid={testId}>
      {icon !== undefined && (
        <span className="kit-chip-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="kit-chip-label">{label}</span>
      <span className="kit-chip-value">{unit === undefined ? text : `${text} ${unit}`}</span>
    </span>
  );
}
