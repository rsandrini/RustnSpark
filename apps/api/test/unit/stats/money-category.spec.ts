import { describe, expect, it } from '@jest/globals';
import {
  BRIDGE_EXPANDED_EVENT,
  BRIDGE_SHRUNK_EVENT,
} from '../../../src/economy/bridge-resize.service.js';
import { MARKET_BUY_EVENT, MARKET_SELL_EVENT } from '../../../src/economy/market.service.js';
import { MATERIAL_SELL_EVENT } from '../../../src/economy/materials.service.js';
import { REFUEL_EVENT } from '../../../src/economy/refuel.service.js';
import { RESCUE_EVENT } from '../../../src/economy/rescue.service.js';
import { moneyKeyOf } from '../../../src/stats/money-category.js';

describe('moneyKeyOf', () => {
  it.each([
    ['in', 'mission:abc:payout', 'money.earned_missions'],
    ['in', `${MARKET_SELL_EVENT}:part-1`, 'money.earned_parts'],
    ['in', `${MATERIAL_SELL_EVENT}:scrap`, 'money.earned_materials'],
    ['in', 'bridge.shrink:part-1', 'money.earned_other'],
    ['in', 'something-new', 'money.earned_other'],
    ['out', `${MARKET_BUY_EVENT}:listing-1`, 'money.spent_parts'],
    ['out', `${REFUEL_EVENT}:ship-1`, 'money.spent_refuel'],
    ['out', 'repair.start:ship-1', 'money.spent_repair'],
    ['out', 'part.upgrade:part-1', 'money.spent_upgrade'],
    ['out', 'bridge.expand:part-1', 'money.spent_resize'],
    ['out', `${RESCUE_EVENT}:ship-1`, 'money.spent_rescue'],
    ['out', 'mission:abc:penalty', 'money.spent_other'],
    ['out', 'something-new', 'money.spent_other'],
  ] as const)('%s %s -> %s', (direction, reason, key) => {
    expect(moneyKeyOf(direction, reason)).toBe(key);
  });

  // The prefixes are literals in the stats module (importing the services there would make a
  // cycle); these checks fail if a service renames its event.
  it("uses the services' own event names", () => {
    expect(BRIDGE_EXPANDED_EVENT).toBe('bridge.expanded');
    expect(BRIDGE_SHRUNK_EVENT).toBe('bridge.shrunk');
    expect(moneyKeyOf('out', 'bridge.expand:x')).toBe('money.spent_resize');
  });
});
