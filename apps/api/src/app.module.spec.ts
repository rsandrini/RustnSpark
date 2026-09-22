import { describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';

describe('AppModule', () => {
  it('compiles', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(moduleRef.get(AppModule)).toBeInstanceOf(AppModule);
  });
});

// Guards the ESM Jest setup: the `jest` object only exists via @jest/globals.
describe('jest ESM globals', () => {
  it('provides mock functions', () => {
    const fn = jest.fn(() => 'ok');
    expect(fn()).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('provides fake timers', () => {
    jest.useFakeTimers();
    try {
      const fn = jest.fn();
      setTimeout(fn, 1000);
      jest.advanceTimersByTime(1000);
      expect(fn).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
