import { describe, expect, it } from '@jest/globals';
import { Reflector } from '@nestjs/core';
import { IDEMPOTENT_KEY, Idempotent } from './idempotent.decorator.js';

class TestController {
  @Idempotent()
  sensitiveRoute(this: void): void {
    /* no-op */
  }

  plainRoute(this: void): void {
    /* no-op */
  }
}

describe('Idempotent decorator', () => {
  it('marks the route as requiring idempotency handling', () => {
    const reflector = new Reflector();
    expect(reflector.get(IDEMPOTENT_KEY, TestController.prototype.sensitiveRoute)).toBe(true);
  });

  it('leaves an undecorated route without the metadata key', () => {
    const reflector = new Reflector();
    expect(reflector.get(IDEMPOTENT_KEY, TestController.prototype.plainRoute)).toBeUndefined();
  });
});
