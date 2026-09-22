import { describe, expect, it } from '@jest/globals';
import { createPinoHttpOptions } from './pino.config.js';

describe('createPinoHttpOptions', () => {
  it('redacts authorization, cookie, password and token fields', () => {
    const { redact } = createPinoHttpOptions('development');
    const paths = (redact as { paths: string[] }).paths;
    expect(paths.some((path) => /authorization/i.test(path))).toBe(true);
    expect(paths.some((path) => /cookie/i.test(path))).toBe(true);
    expect(paths.some((path) => /password/i.test(path))).toBe(true);
    expect(paths.some((path) => /token/i.test(path))).toBe(true);
  });

  it('censors redacted values instead of dropping the key', () => {
    const { redact } = createPinoHttpOptions('development');
    expect((redact as { censor: string }).censor).toBe('[REDACTED]');
  });

  it('uses info level in production, debug in development and silent in test', () => {
    expect(createPinoHttpOptions('production').level).toBe('info');
    expect(createPinoHttpOptions('development').level).toBe('debug');
    expect(createPinoHttpOptions('test').level).toBe('silent');
  });

  it('disables autoLogging in test to keep test output pristine', () => {
    expect(createPinoHttpOptions('test').autoLogging).toBe(false);
    expect(createPinoHttpOptions('development').autoLogging).toBe(true);
  });

  it('assigns the existing request id or generates one', () => {
    const { genReqId } = createPinoHttpOptions('development');
    const withId = genReqId?.({ id: 'existing-id' } as never, {} as never);
    expect(withId).toBe('existing-id');
    const withoutId = genReqId?.({} as never, {} as never);
    expect(typeof withoutId).toBe('string');
    expect(withoutId).not.toBe('');
  });
});
