/**
 * Where the money goes: one signed ledger of every credit the run earns or spends, by category.
 * Credits in are positive, credits out negative — `totals()` is what the report and the SQLite
 * `runs` row store.
 */

export const LEDGER_CATEGORIES = [
  'reward',
  'combat',
  'scavengeSale',
  'oreSale',
  'fuel',
  'repair',
  'upgrade',
  'purchase',
  'sale',
] as const;

export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number];

export type LedgerTotals = Record<LedgerCategory, number>;

export interface Ledger {
  /** Record a signed credit flow (positive = earned, negative = spent). */
  record(category: LedgerCategory, amount: number): void;
  /** Net flow in one category. */
  total(category: LedgerCategory): number;
  /** Every category's net flow. */
  totals(): LedgerTotals;
  /** Earned minus spent across all categories. */
  net(): number;
}

function emptyTotals(): LedgerTotals {
  return {
    reward: 0,
    combat: 0,
    scavengeSale: 0,
    oreSale: 0,
    fuel: 0,
    repair: 0,
    upgrade: 0,
    purchase: 0,
    sale: 0,
  };
}

export function createLedger(): Ledger {
  const totals = emptyTotals();
  return {
    record(category: LedgerCategory, amount: number): void {
      totals[category] += amount;
    },
    total(category: LedgerCategory): number {
      return totals[category];
    },
    totals(): LedgerTotals {
      return { ...totals };
    },
    net(): number {
      return LEDGER_CATEGORIES.reduce((sum, category) => sum + totals[category], 0);
    },
  };
}
