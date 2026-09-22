import { describe, expect, it } from '@jest/globals';
import { InvalidPlayerEventError, assertValidEventType } from './player-event.service.js';

describe('assertValidEventType', () => {
  it('accepts a non-empty event type', () => {
    expect(() => assertValidEventType('wallet.debit')).not.toThrow();
  });

  it.each(['', '   '])('rejects the blank event type %p', (type) => {
    expect(() => assertValidEventType(type)).toThrow(InvalidPlayerEventError);
  });

  it('rejects a non-string event type', () => {
    expect(() => assertValidEventType(7 as unknown as string)).toThrow(InvalidPlayerEventError);
  });
});
