import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from './Tooltip';

const GLYPH = '?';

export interface HelpTipProps {
  /** The button's accessible name; defaults to the shared "Help". */
  label?: string;
  /** The explanation: the text that used to sit on the screen as a paragraph. */
  children: ReactNode;
  /** Which edge of the button the card hangs from; 'end' near the right edge of the screen. */
  align?: 'start' | 'end';
  /** Carried through to the button (the opening's steps point at it by `data-tour`). */
  'data-tour'?: string;
}

/**
 * A small "?" that holds an explanation: on hover, focus and tap it shows the kit tooltip card, which the button is
 * described by, so assistive technology reads the text too. Use it for text that only explains; a state or a warning
 * the pilot must act on stays on the screen.
 */
export function HelpTip({ label, children, align = 'start', 'data-tour': tour }: HelpTipProps) {
  const { t } = useTranslation();
  return (
    <Tooltip content={children} align={align}>
      <button
        type="button"
        className="help-tip"
        aria-label={label ?? t('ui.help')}
        data-tour={tour}
      >
        <span aria-hidden="true">{GLYPH}</span>
      </button>
    </Tooltip>
  );
}
