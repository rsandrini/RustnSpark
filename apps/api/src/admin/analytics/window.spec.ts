import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from '@jest/globals';
import { DEFAULT_WINDOW_MS, parseWindow } from './window.js';

describe('parseWindow (S11.3)', () => {
  const now = new Date('2026-09-25T12:00:00.000Z');

  it('defaults to the last 7 days ending now', () => {
    const window = parseWindow(undefined, undefined, now);
    expect(window.to).toEqual(now);
    expect(window.from).toEqual(new Date(now.getTime() - DEFAULT_WINDOW_MS));
  });

  it('honours explicit ISO bounds', () => {
    const window = parseWindow('2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z', now);
    expect(window.from).toEqual(new Date('2026-09-01T00:00:00.000Z'));
    expect(window.to).toEqual(new Date('2026-09-02T00:00:00.000Z'));
  });

  it('fills only the missing bound', () => {
    const fromOnly = parseWindow('2026-09-20T00:00:00.000Z', undefined, now);
    expect(fromOnly.to).toEqual(now);
    const toOnly = parseWindow(undefined, '2026-09-24T00:00:00.000Z', now);
    expect(toOnly.from).toEqual(new Date(toOnly.to.getTime() - DEFAULT_WINDOW_MS));
  });

  it('rejects a non-ISO instant', () => {
    expect(() => parseWindow('yesterday', undefined, now)).toThrow(BadRequestException);
    expect(() => parseWindow(undefined, 'soon', now)).toThrow(BadRequestException);
  });

  it('rejects an empty or inverted window', () => {
    expect(() => parseWindow('2026-09-02T00:00:00.000Z', '2026-09-01T00:00:00.000Z', now)).toThrow(
      BadRequestException,
    );
    expect(() => parseWindow('2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', now)).toThrow(
      BadRequestException,
    );
  });
});
