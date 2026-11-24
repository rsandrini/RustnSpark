import type { ReactNode } from 'react';

export interface NeedChipProps {
  label: string;
  /** The longer explanation, as a hover hint. */
  title?: string;
  /** The icon of what is missing; a plus mark when omitted. */
  icon?: ReactNode;
  /** The whole chip is this button: the way to what fixes the need. */
  onShow: () => void;
  /** A small mark on the chip that dismisses it; needs `dismissLabel` for its accessible name. */
  onDismiss?: () => void;
  dismissLabel?: string;
  dismissMark?: string;
  testId?: string;
}

/**
 * What the ship could use, as a chip. Advice, not a block: the amber tone and a plus mark, where
 * `BlockerChip` is the red "cannot do this". The chip is a button (the dismiss mark is its sibling,
 * as a button cannot hold a button).
 */
export function NeedChip({
  label,
  title,
  icon,
  onShow,
  onDismiss,
  dismissLabel,
  dismissMark = '×',
  testId,
}: NeedChipProps) {
  return (
    <span className="kit-need" data-testid={testId}>
      <button type="button" className="kit-need-main" title={title} onClick={onShow}>
        {icon ?? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        )}
        {label}
      </button>
      {onDismiss !== undefined && (
        <button
          type="button"
          className="kit-need-dismiss"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          {dismissMark}
        </button>
      )}
    </span>
  );
}
