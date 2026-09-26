import { SetMetadata } from '@nestjs/common';

// 'account' keys by the authenticated account (falling back to the IP without a valid token).
export type ThrottleKeyStrategy = 'ip' | 'ip+email' | 'account';

export interface ThrottleRoutePolicy {
  limit: number;
  ttlMs: number;
  key: ThrottleKeyStrategy;
}

export const THROTTLE_ROUTE_KEY = 'throttleRoutePolicy';

// R20: marks a route with its own throttle policy, which REPLACES ThrottlerGuard's global
// default on that route (one limiter applies, not both). Login is 5/min per IP+email, register
// 3/min per IP; everything else keeps the default per-IP limiter.
export const ThrottleRoute = (policy: ThrottleRoutePolicy) =>
  SetMetadata(THROTTLE_ROUTE_KEY, policy);
