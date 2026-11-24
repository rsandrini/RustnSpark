import type { PortFit } from './port-fit';

export interface FitView {
  tone: 'ok' | 'bad';
  icon: string;
  /** The `connectors.fit.<key>` sentence. */
  key: 'full' | 'partial' | 'none' | 'noneFree';
  counts: { matching: number; total: number };
}

/** How a fit reads in the UI (tone, icon, sentence key and its counts); undefined when there is nothing to say. */
export function fitView(fit: PortFit | undefined): FitView | undefined {
  if (fit === undefined || fit.level === 'unknown' || fit.level === 'no-ports') return undefined;
  if (fit.level === 'none-free') {
    return { tone: 'bad', icon: '✕', key: 'noneFree', counts: { matching: 0, total: 0 } };
  }
  const counts = { matching: fit.matching, total: fit.total };
  if (fit.level === 'none') return { tone: 'bad', icon: '✕', key: 'none', counts };
  return { tone: 'ok', icon: '✓', key: fit.level, counts };
}
