// The engine sliders save a moment after the pilot stops moving them. Dispatch must not leave
// before that save lands, or the trip would fly with the old levels: the tuning panel registers
// a "save now" here and the dispatch button calls it first.
type Flush = () => Promise<void>;

let current: Flush | null = null;

/** Registers the panel's save-now; returns the function that removes it again. */
export function registerEngineTuningFlush(flush: Flush): () => void {
  current = flush;
  return () => {
    if (current === flush) current = null;
  };
}

/** Saves any pending slider change; resolves at once when there is none (or no panel is open). */
export async function flushEngineTuning(): Promise<void> {
  await current?.();
}
