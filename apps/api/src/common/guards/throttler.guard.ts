import {
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

export const THROTTLE_TTL_MS = 60_000;
export const THROTTLE_LIMIT = 60;

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

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ ip?: string }>();
    const key = request.ip ?? 'unknown';
    const now = Date.now();
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
}
