import { createContext, useContext } from 'react';
import type { PrologueOffers } from './prologue-fixtures';

/** What every scene of the opening reads: the server's payouts and the offers built from them. */
export interface PrologueData {
  readonly payouts: readonly number[];
  /** What the refuel at the first stop costs (the payouts cover it). */
  readonly refuelCost: number;
  /** The pilot has paid for the refuel at the first stop. */
  readonly refuelled: boolean;
  readonly payRefuel: () => void;
  readonly offers: PrologueOffers;
}

export const PrologueDataContext = createContext<PrologueData | null>(null);

export function usePrologueData(): PrologueData {
  const data = useContext(PrologueDataContext);
  if (data === null) throw new Error('usePrologueData needs the opening to have loaded');
  return data;
}
