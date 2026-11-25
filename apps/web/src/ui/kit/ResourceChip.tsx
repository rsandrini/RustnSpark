import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useCountUp } from '../use-count-up';

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
  const { shown, direction: flash } = useCountUp(value);
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
