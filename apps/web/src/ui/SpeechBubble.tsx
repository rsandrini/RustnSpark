// The mentor's line beside the getting-started checklist (plan §9): flavour on top of the
// plain step text, never replacing it — the step title and detail stay factual. Purely
// presentational: the caller decides which line (welcome, nudge, done…) or none to show.
export interface SpeechBubbleProps {
  text: string;
  /** Extra class for the caller's layout (e.g. collapsed phone pill). */
  className?: string;
}

export function SpeechBubble({ text, className }: SpeechBubbleProps) {
  return (
    <p className={className === undefined ? 'speech-bubble' : `speech-bubble ${className}`}>
      {text}
    </p>
  );
}
