import type { PortFit } from './port-fit';

export interface FitView {
  tone: 'bad';
  icon: string;
  /** The `connectors.fit.<key>` sentence. */
  key: 'none' | 'noneFree';
  counts: { matching: number; total: number };
}

/** A fit message exists only when the part does NOT fit; a part that joins says nothing. */
export function fitView(fit: PortFit | undefined): FitView | undefined {
  if (fit === undefined) return undefined;
  if (fit.level === 'none-free') {
    return { tone: 'bad', icon: '✕', key: 'noneFree', counts: { matching: 0, total: 0 } };
  }
  if (fit.level === 'none') {
    return {
      tone: 'bad',
      icon: '✕',
      key: 'none',
      counts: { matching: fit.matching, total: fit.total },
    };
  }
  return undefined;
}
