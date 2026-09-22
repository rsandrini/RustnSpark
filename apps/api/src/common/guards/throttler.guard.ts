import {
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

export const THROTTLE_TTL_MS = 60_000;
export const THROTTLE_LIMIT = 60;
// This is the production limiter until S12.1's Redis-backed store, not a throwaway stopgap:
// sweep at most this often so the in-memory Map can't grow unbounded from clients that never
// return (a long-running single instance otherwise leaks one entry per distinct IP forever).
export const SWEEP_INTERVAL_MS = 60_000;

interface Bucket {
  count: number;
  resetAt: number;
}

// Hand-rolled instead of @nestjs/throttler: that package still ships CommonJS and its
// `require('@nestjs/common')` breaks under this project's Jest ESM runtime (works at real
// Node runtime, confirmed, but not under `--experimental-vm-modules` on Node 22). A fixed
// window per client IP is enough for a single-instance v0.1 API.
@Injectable()
export class ThrottlerGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweepAt = 0;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ ip?: string }>();
    const key = request.ip ?? 'unknown';
    const now = Date.now();

    this.sweepExpired(now);

    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + THROTTLE_TTL_MS });
      return true;
    }

    if (bucket.count >= THROTTLE_LIMIT) {
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    bucket.count += 1;
    return true;
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
