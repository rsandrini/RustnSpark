import { Link } from 'react-router';

export interface BlockerChipProps {
  label: string;
  onFix?: () => void;
  /** An external or full-page address (a plain link: the page reloads). */
  href?: string;
  /** An in-app path: a router link, so the app is not reloaded. Needs a router around it. */
  to?: string;
  /** Extra classes, for a caller that styles its own kind of chip. */
  className?: string;
  testId?: string;
  state?: string;
}

/** What blocks an action, as a chip. With `onFix` or `href` the whole chip is the way to the fix. */
export function BlockerChip({
  label,
  onFix,
  href,
  to,
  className,
  testId,
  state,
}: BlockerChipProps) {
  const cls = className === undefined ? 'kit-blocker' : `kit-blocker ${className}`;
  const attrs = { 'data-testid': testId, 'data-state': state };
  const body = (
    <>
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
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
      {label}
    </>
  );
  if (to !== undefined) {
    return (
      <Link className={cls} to={to} {...attrs}>
        {body}
      </Link>
    );
  }
  if (href !== undefined) {
    return (
      <a className={cls} href={href} {...attrs}>
        {body}
      </a>
    );
  }
  if (onFix !== undefined) {
    return (
      <button type="button" className={cls} onClick={onFix} {...attrs}>
        {body}
      </button>
    );
  }
  return (
    <span className={cls} {...attrs}>
      {body}
    </span>
  );
}
