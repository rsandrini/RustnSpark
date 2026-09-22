import { describe, expect, it } from '@jest/globals';
import { Reflector } from '@nestjs/core';
import {
  THROTTLE_ROUTE_KEY,
  ThrottleRoute,
  type ThrottleRoutePolicy,
} from './throttle-route.decorator.js';

const POLICY: ThrottleRoutePolicy = { limit: 5, ttlMs: 60_000, key: 'ip+email' };

class TestController {
  @ThrottleRoute(POLICY)
  throttledRoute(this: void): void {
    /* no-op */
  }

  defaultRoute(this: void): void {
    /* no-op */
  }
}

describe('ThrottleRoute decorator', () => {
  it('stores the policy on a decorated method under the throttle-route metadata key', () => {
    const reflector = new Reflector();
    expect(reflector.get(THROTTLE_ROUTE_KEY, TestController.prototype.throttledRoute)).toEqual(
      POLICY,
    );
  });

  it('leaves an undecorated method without the metadata key', () => {
    const reflector = new Reflector();
    expect(
      reflector.get(THROTTLE_ROUTE_KEY, TestController.prototype.defaultRoute),
    ).toBeUndefined();
  });
});
