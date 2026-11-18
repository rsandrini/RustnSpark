import { describe, expect, it } from 'vitest';
import { raiseCurtain, takeCurtain } from './curtain';

describe('the curtain', () => {
  it('is down by default, rises once and is taken once', () => {
    expect(takeCurtain()).toBe(false);
    raiseCurtain();
    expect(takeCurtain()).toBe(true);
    expect(takeCurtain()).toBe(false);
  });
});
