import { describe, expect, it } from '@jest/globals';
import { Reflector } from '@nestjs/core';
import { OwnedResource, OWNED_RESOURCE_KEY } from './owned-resource.decorator.js';

class TestController {
  @OwnedResource({ type: 'ship', param: 'shipId' })
  getShip(this: void): void {
    /* no-op */
  }

  openRoute(this: void): void {
    /* no-op */
  }
}

describe('OwnedResource decorator', () => {
  it('stores the resolver type and route param name', () => {
    const reflector = new Reflector();
    expect(reflector.get(OWNED_RESOURCE_KEY, TestController.prototype.getShip)).toEqual({
      type: 'ship',
      param: 'shipId',
    });
  });

  it('leaves an undecorated method without the metadata key', () => {
    const reflector = new Reflector();
    expect(reflector.get(OWNED_RESOURCE_KEY, TestController.prototype.openRoute)).toBeUndefined();
  });
});
