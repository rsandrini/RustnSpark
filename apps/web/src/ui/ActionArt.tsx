export type ActionArtKind = 'scavenge-ship' | 'scavenge-foot' | 'mining';

// Small flat illustrations for the port actions (decorative: the text next to them says it all).
export function ActionArt({ kind }: { kind: ActionArtKind }) {
  return (
    <svg
      className={`action-art art-${kind}`}
      viewBox="0 0 160 90"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="160" height="90" className="art-sky" />
      <circle cx="18" cy="14" r="1.2" className="art-star" />
      <circle cx="60" cy="9" r="1" className="art-star" />
      <circle cx="132" cy="16" r="1.4" className="art-star" />
      <circle cx="104" cy="28" r="1" className="art-star" />
      {/* wreckage / rock field on the ground */}
      <path d="M0 74 Q40 62 80 72 T160 68 V90 H0 Z" className="art-ground" />
      {kind === 'mining' ? (
        <>
          <path d="M96 72 L110 44 L126 58 L136 40 L150 72 Z" className="art-rock" />
          <path d="M110 44 L116 56 L126 58" className="art-vein" />
          <path d="M136 40 L140 54" className="art-vein" />
          {/* the ship with a drill beam */}
          <path d="M30 40 L62 34 L72 42 L62 50 L30 46 Z" className="art-ship" />
          <path d="M72 42 L100 56" className="art-beam" />
          <circle cx="102" cy="57" r="3" className="art-spark" />
        </>
      ) : kind === 'scavenge-ship' ? (
        <>
          <path d="M86 70 l10 -12 l8 6 l6 -9 l10 15 z" className="art-wreck" />
          <rect x="120" y="60" width="14" height="8" rx="1" className="art-wreck" />
          <path d="M28 34 L60 28 L72 36 L60 44 L28 40 Z" className="art-ship" />
          <path d="M64 44 L98 62" className="art-beam" />
          <circle cx="100" cy="63" r="3" className="art-spark" />
        </>
      ) : (
        <>
          <path d="M86 70 l10 -12 l8 6 l6 -9 l10 15 z" className="art-wreck" />
          <rect x="120" y="60" width="14" height="8" rx="1" className="art-wreck" />
          {/* a pilot on foot, the ship parked behind */}
          <path d="M14 56 L40 52 L48 58 L40 64 L14 62 Z" className="art-ship" />
          <circle cx="68" cy="52" r="5" className="art-suit" />
          <rect x="63" y="57" width="10" height="14" rx="3" className="art-suit" />
          <path d="M73 62 L86 66" className="art-beam" />
        </>
      )}
    </svg>
  );
}
