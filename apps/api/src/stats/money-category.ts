import type { StatKey } from './stat-keys.js';

export type MoneyDirection = 'in' | 'out';

// The wallet reasons are `<event>:<id>`; these are the event parts the services use (the
// services' own constants, copied as literals here so the stats module never imports them and
// forms a cycle; a unit test pins them against the constants). Order matters where one prefix
// starts another ('market.sell_material' before 'market.sell').
const EARNED: readonly (readonly [prefix: string, key: StatKey])[] = [
  ['market.sell_material:', 'money.earned_materials'],
  ['market.sell:', 'money.earned_parts'],
];
const SPENT: readonly (readonly [prefix: string, key: StatKey])[] = [
  ['market.buy:', 'money.spent_parts'],
  ['refuel:', 'money.spent_refuel'],
  ['repair.start:', 'money.spent_repair'],
  ['part.upgrade:', 'money.spent_upgrade'],
  ['bridge.expand:', 'money.spent_resize'],
  ['bridge.shrink:', 'money.spent_resize'],
  ['rescue:', 'money.spent_rescue'],
];
const MISSION_PAYOUT = /^mission:[^:]+:payout$/;

/** Which money counter a wallet movement belongs to, from its reason string. */
export function moneyKeyOf(direction: MoneyDirection, reason: string): StatKey {
  if (direction === 'in') {
    if (MISSION_PAYOUT.test(reason)) return 'money.earned_missions';
    return EARNED.find(([prefix]) => reason.startsWith(prefix))?.[1] ?? 'money.earned_other';
  }
  return SPENT.find(([prefix]) => reason.startsWith(prefix))?.[1] ?? 'money.spent_other';
}
