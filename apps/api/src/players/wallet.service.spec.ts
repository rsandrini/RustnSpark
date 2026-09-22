import { describe, expect, it } from '@jest/globals';
import {
  InsufficientFundsError,
  InvalidWalletOperationError,
  WalletError,
  assertValidWalletOperation,
} from './wallet.service.js';

describe('assertValidWalletOperation', () => {
  it('accepts a positive integer amount and a non-empty reason', () => {
    expect(() => assertValidWalletOperation(1, 'mission-reward')).not.toThrow();
  });

  it.each([0, -10, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects the non-positive or non-integer amount %p',
    (amount) => {
      expect(() => assertValidWalletOperation(amount, 'reason')).toThrow(
        InvalidWalletOperationError,
      );
    },
  );

  it('rejects a non-numeric amount', () => {
    expect(() => assertValidWalletOperation('10' as unknown as number, 'reason')).toThrow(
      InvalidWalletOperationError,
    );
  });

  it.each(['', '   '])('rejects the blank reason %p', (reason) => {
    expect(() => assertValidWalletOperation(10, reason)).toThrow(InvalidWalletOperationError);
  });

  it('rejects a non-string reason', () => {
    expect(() => assertValidWalletOperation(10, 42 as unknown as string)).toThrow(
      InvalidWalletOperationError,
    );
  });

  it('throws a WalletError subtype so callers can catch the family', () => {
    try {
      assertValidWalletOperation(0, 'reason');
      throw new Error('expected assertValidWalletOperation to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WalletError);
      expect(error).toBeInstanceOf(InvalidWalletOperationError);
    }
  });
});

describe('InsufficientFundsError', () => {
  it('carries the INSUFFICIENT_FUNDS machine code', () => {
    const error = new InsufficientFundsError('player-1', 10);
    expect(error).toBeInstanceOf(WalletError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('INSUFFICIENT_FUNDS');
  });
});
