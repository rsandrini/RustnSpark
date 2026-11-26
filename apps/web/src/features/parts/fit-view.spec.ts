import { describe, expect, it } from 'vitest';
import { fitView } from './fit-view';

describe('fitView: only a part that does not fit is announced', () => {
  it('says nothing for full and partial fits', () => {
    expect(fitView({ level: 'full', matching: 2, total: 2 })).toBeUndefined();
    expect(fitView({ level: 'partial', matching: 1, total: 3 })).toBeUndefined();
  });

  it('says nothing for unknown, no-ports or absent', () => {
    expect(fitView({ level: 'unknown' })).toBeUndefined();
    expect(fitView({ level: 'no-ports' })).toBeUndefined();
    expect(fitView(undefined)).toBeUndefined();
  });

  it('flags none and none-free as bad', () => {
    expect(fitView({ level: 'none', matching: 0, total: 3 })).toMatchObject({
      tone: 'bad',
      key: 'none',
    });
    expect(fitView({ level: 'none-free' })).toMatchObject({ tone: 'bad', key: 'noneFree' });
  });
});
