import {
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  THROTTLE_ROUTE_KEY,
  type ThrottleRoutePolicy,
} from '../decorators/throttle-route.decorator.js';

export const THROTTLE_TTL_MS = 60_000;
// Per-IP default for every route without its own @ThrottleRoute policy (auth routes keep
// their strict ones). The browser client polls (transit every few seconds, board, reports)
// and several players can share one NAT'd IP, so the old 60/min tripped in ordinary play;
// 300/min still stops a scripted flood.
export const THROTTLE_LIMIT = 300;
// This is the production limiter until S12.1's Redis-backed store, not a throwaway stopgap:
// sweep at most this often so the in-memory Map can't grow unbounded from clients that never
// return (a long-running single instance otherwise leaks one entry per distinct IP forever).
export const SWEEP_INTERVAL_MS = 60_000;

interface Bucket {
  count: number;
  resetAt: number;
}

interface ThrottleRequest {
  ip?: string;
  body?: unknown;
}

// Hand-rolled instead of @nestjs/throttler: that package still ships CommonJS and its
// `require('@nestjs/common')` breaks under this project's Jest ESM runtime (works at real
// Node runtime, confirmed, but not under `--experimental-vm-modules` on Node 22). A fixed
// window per client IP is enough for a single-instance v0.1 API.
@Injectable()
export class ThrottlerGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweepAt = 0;

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ThrottleRequest>();
    // R20: a @ThrottleRoute policy REPLACES the default limiter on that route (one limiter total).
    const policy = this.reflector.getAllAndOverride<ThrottleRoutePolicy | undefined>(
      THROTTLE_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    const now = Date.now();

    this.sweepExpired(now);

    const limit = policy?.limit ?? THROTTLE_LIMIT;
    const ttlMs = policy?.ttlMs ?? THROTTLE_TTL_MS;
    const key = this.bucketKey(context, request, policy);
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + ttlMs });
      return true;
    }

    if (bucket.count >= limit) {
      this.setRetryAfter(context, bucket.resetAt - now);
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    bucket.count += 1;
    return true;
  }

  private bucketKey(
    context: ExecutionContext,
    request: ThrottleRequest,
    policy: ThrottleRoutePolicy | undefined,
  ): string {
    const ip = request.ip ?? 'unknown';
    if (!policy) return ip; // default: one bucket per client IP shared across unmarked routes.
    // Policy buckets are namespaced per handler, so two policy routes never share one.
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    if (policy.key === 'ip+email') return `${route}|${ip}|${emailKey(request)}`;
    return `${route}|${ip}`;
  }

  private setRetryAfter(context: ExecutionContext, msUntilReset: number): void {
    const response = context
      .switchToHttp()
      .getResponse<{ setHeader(name: string, value: string): void }>();
    response.setHeader('Retry-After', String(Math.max(1, Math.ceil(msUntilReset / 1000))));
  }

  // Opportunistic, bounded-frequency sweep: runs on a request rather than a timer, so there is
  // nothing to unref/clear on shutdown, but never more often than SWEEP_INTERVAL_MS regardless
  // of request volume, so its O(n) scan can't itself become a hot path under heavy traffic.
  private sweepExpired(now: number): void {
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS) return;
    this.lastSweepAt = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

// The guard runs before the ValidationPipe, so the body is unvalidated here: only a string email
// participates in the key, and it is lowercased so casing can't dodge the bucket (matches R17's
// normalization). Missing/malformed bodies share one bucket per IP on that route.
function emailKey(request: ThrottleRequest): string {
  const body = request.body;
  if (typeof body !== 'object' || body === null) return '';
  const email = (body as { email?: unknown }).email;
  return typeof email === 'string' ? email.toLowerCase() : '';
}
