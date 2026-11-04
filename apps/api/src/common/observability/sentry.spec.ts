import { afterEach, describe, expect, it } from '@jest/globals';
import { captureJobFailure, captureServerError, initSentry } from './sentry.js';

describe('error tracking', () => {
  const original = process.env['SENTRY_DSN'];
  afterEach(() => {
    if (original === undefined) delete process.env['SENTRY_DSN'];
    else process.env['SENTRY_DSN'] = original;
  });

  it('stays off without a DSN (CI, tests, local shells send nothing)', () => {
    delete process.env['SENTRY_DSN'];
    expect(initSentry('api')).toBe(false);
    process.env['SENTRY_DSN'] = '   ';
    expect(initSentry('worker')).toBe(false);
  });

  it('reporting while off is a harmless no-op', () => {
    delete process.env['SENTRY_DSN'];
    expect(() => captureServerError(new Error('x'), 'req-1')).not.toThrow();
    expect(() => captureJobFailure('mission', undefined, new Error('x'))).not.toThrow();
  });
});
