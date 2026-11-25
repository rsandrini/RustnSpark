import { useTranslation } from 'react-i18next';
import { useCountUp } from './use-count-up';

export interface CountUpProps {
  value: number;
  /** Turns a number into its text (default: the number in the language of the page). */
  format?: (value: number) => string;
  unit?: string;
  className?: string;
  from?: number;
  animateOnMount?: boolean;
  /** Add the visually hidden final value (default). Off when the parent already names the final value. */
  srFinal?: boolean;
}

/**
 * A number that counts to its new value. Screen readers get the final value at once (a visually hidden span);
 * the counting text is hidden from them so they do not hear every step.
 */
export function CountUp({
  value,
  format,
  unit,
  className,
  from,
  animateOnMount,
  srFinal = true,
}: CountUpProps) {
  const { i18n } = useTranslation();
  const { shown } = useCountUp(value, { from, animateOnMount });
  const write = format ?? ((n: number) => new Intl.NumberFormat(i18n.language).format(n));
  const withUnit = (n: number) => (unit === undefined ? write(n) : `${write(n)} ${unit}`);
  return (
    <>
      {srFinal && <span className="sr-only">{withUnit(value)}</span>}
      <span className={className} aria-hidden="true">
        {withUnit(shown)}
      </span>
    </>
  );
}
