import type { ThrottleRoutePolicy } from '../decorators/throttle-route.decorator.js';

// S12.1 rate-limit policy matrix. These are infrastructure limits (abuse control), not game
// balance, so they live in code, not in GameConfig (D42). One class per kind of route:
//
//   auth     login / register — strict, keyed by IP (+ email for login); set per route.
//   intent   POST/PUT/PATCH/DELETE — a player action that changes state; moderate.
//   read     GET — the client polls (transit, board, reports); generous.
//   preview  side-effect-free POSTs the UI fires while the player edits (ship stats, repair
//            quote); generous, since they are read-shaped.
//
// Authenticated routes are keyed by ACCOUNT (falling back to IP when there is no valid token),
// so players sharing one NAT'd address — a household, a school — do not share a bucket.
export const THROTTLE_TTL_MS = 60_000;

export const READ_POLICY: ThrottleRoutePolicy = {
  limit: 300,
  ttlMs: THROTTLE_TTL_MS,
  key: 'account',
};
export const INTENT_POLICY: ThrottleRoutePolicy = {
  limit: 120,
  ttlMs: THROTTLE_TTL_MS,
  key: 'account',
};
export const PREVIEW_POLICY: ThrottleRoutePolicy = {
  limit: 240,
  ttlMs: THROTTLE_TTL_MS,
  key: 'account',
};
// Registration is per IP but households and schools share an address: 3/min made a second
// sibling wait, 10/min still stops a scripted signup flood.
export const REGISTER_POLICY: ThrottleRoutePolicy = {
  limit: 10,
  ttlMs: THROTTLE_TTL_MS,
  key: 'ip',
};
export const LOGIN_POLICY: ThrottleRoutePolicy = {
  limit: 5,
  ttlMs: THROTTLE_TTL_MS,
  key: 'ip+email',
};

/** Policy of a route with no explicit @ThrottleRoute: by HTTP method. */
export function isReadMethod(method: string | undefined): boolean {
  const verb = (method ?? 'GET').toUpperCase();
  return verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS';
}

export function defaultPolicyFor(method: string | undefined): ThrottleRoutePolicy {
  return isReadMethod(method) ? READ_POLICY : INTENT_POLICY;
}

/** Interim per-IP default of D42, kept as the read class limit. */
export const THROTTLE_LIMIT = READ_POLICY.limit;
