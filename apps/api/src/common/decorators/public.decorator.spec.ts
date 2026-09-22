import { describe, expect, it } from '@jest/globals';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, Public } from './public.decorator.js';

class TestController {
  @Public()
  publicRoute(this: void): void {
    /* no-op */
  }

  privateRoute(this: void): void {
    /* no-op */
  }
}

describe('Public decorator', () => {
  it('marks a decorated method with the isPublic metadata key', () => {
    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC_KEY, TestController.prototype.publicRoute)).toBe(true);
  });

  it('leaves an undecorated method without the metadata key', () => {
    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC_KEY, TestController.prototype.privateRoute)).toBeUndefined();
  });
});
