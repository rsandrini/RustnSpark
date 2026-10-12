import { describe, expect, it } from '@jest/globals';
import { createLedger, LEDGER_CATEGORIES } from '../../../sim/core/ledger.js';

describe('sim ledger', () => {
  it('nets every category and the grand total', () => {
    const ledger = createLedger();
    ledger.record('reward', 120);
    ledger.record('combat', 30);
    ledger.record('fuel', -45);
    ledger.record('repair', -15);
    expect(ledger.total('reward')).toBe(120);
    expect(ledger.total('fuel')).toBe(-45);
    expect(ledger.net()).toBe(120 + 30 - 45 - 15);
  });

  it('starts every category at zero and copies totals out', () => {
    const ledger = createLedger();
    const totals = ledger.totals();
    for (const category of LEDGER_CATEGORIES) {
      expect(totals[category]).toBe(0);
    }
    ledger.record('sale', 7);
    totals.sale = 999;
    expect(ledger.totals().sale).toBe(7);
  });
});
