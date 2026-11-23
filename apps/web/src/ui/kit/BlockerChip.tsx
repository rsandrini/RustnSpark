export interface BlockerChipProps {
  label: string;
  onFix?: () => void;
  href?: string;
}

/** What blocks an action, as a chip. With `onFix` or `href` the whole chip is the way to the fix. */
export function BlockerChip({ label, onFix, href }: BlockerChipProps) {
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
  if (href !== undefined) {
    return (
      <a className="kit-blocker" href={href}>
        {body}
      </a>
    );
  }
  if (onFix !== undefined) {
    return (
      <button type="button" className="kit-blocker" onClick={onFix}>
        {body}
      </button>
    );
  }
  return <span className="kit-blocker">{body}</span>;
}
