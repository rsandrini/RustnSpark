import { describe, expect, it } from 'vitest';
import { rangeBudget, reachableWithin } from './reach';

const r = (nodeAId: string, nodeBId: string, distance: number) => ({ nodeAId, nodeBId, distance });
const chain = [r('A', 'B', 10), r('B', 'C', 20)];

describe('reachableWithin', () => {
  it('stops at the budget', () => {
    expect([...reachableWithin(chain, 'A', 25).keys()].sort()).toEqual(['A', 'B']);
    expect(reachableWithin(chain, 'A', 30).get('C')).toBe(30);
  });

  it('walks routes both ways', () => {
    expect(reachableWithin(chain, 'C', 20).get('B')).toBe(20);
  });

  it('prefers a shorter two-hop path over a long direct route', () => {
    const m = reachableWithin([r('A', 'C', 100), r('A', 'B', 10), r('B', 'C', 20)], 'A', 200);
    expect(m.get('C')).toBe(30);
  });

  it('leaves out an unreachable island', () => {
    expect(reachableWithin([...chain, r('X', 'Y', 1)], 'A', 1000).has('X')).toBe(false);
  });

  it('always has the origin at 0', () => {
    expect(reachableWithin([], 'A', 0).get('A')).toBe(0);
  });
});

describe('rangeBudget', () => {
  const base = { autonomy: 100, fuelUse: 5, fuelHave: 50, fuelCap: 100 };
  it('is proportional to the fuel on board', () => {
    expect(rangeBudget(base)).toBe(50);
  });
  it('is unlimited without fuel use', () => {
    expect(rangeBudget({ ...base, fuelUse: 0 })).toBe('unlimited');
  });
  it('is 0 without a tank', () => {
    expect(rangeBudget({ ...base, fuelCap: 0 })).toBe(0);
  });
});
