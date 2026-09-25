import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TokenService } from '../../auth/token.service.js';
import {
  THROTTLE_ROUTE_KEY,
  type ThrottleRoutePolicy,
} from '../decorators/throttle-route.decorator.js';
import {
  defaultPolicyFor,
  isReadMethod,
  THROTTLE_LIMIT,
  THROTTLE_TTL_MS,
} from '../throttling/policies.js';
import {
  MemoryThrottleStore,
  SWEEP_INTERVAL_MS,
  THROTTLE_STORE,
  type ThrottleStore,
} from '../throttling/throttle-store.js';

export { SWEEP_INTERVAL_MS, THROTTLE_LIMIT, THROTTLE_TTL_MS };

interface ThrottleRequest {
  ip?: string;
  method?: string;
  headers?: { authorization?: string };
  body?: unknown;
}

// Hand-rolled instead of @nestjs/throttler: that package still ships CommonJS and its
// `require('@nestjs/common')` breaks under this project's Jest ESM runtime. The counting lives
// in a ThrottleStore (Redis in the app, so limits hold across instances — S12.1; memory in
// unit tests); the policy matrix lives in throttling/policies.ts.
//
// Runs BEFORE JwtAuthGuard (R28), so an account-keyed bucket cannot use request.user: the
// bearer token is verified here (stateless, signature only) purely to pick the bucket. A missing
// or invalid token falls back to the client IP, so unauthenticated floods are still per IP.
@Injectable()
export class ThrottlerGuard implements CanActivate {
  private readonly store: ThrottleStore;

  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(THROTTLE_STORE) store?: ThrottleStore,
    @Optional() private readonly tokens?: TokenService,
  ) {
    this.store = store ?? new MemoryThrottleStore();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ThrottleRequest>();
    // R20: a @ThrottleRoute policy REPLACES the class default on that route (one limiter total).
    const explicit = this.reflector.getAllAndOverride<ThrottleRoutePolicy | undefined>(
      THROTTLE_ROUTE_KEY,
      [context.getHandler(), context.getClass()],
    );
    const policy = explicit ?? defaultPolicyFor(request.method);
    const key = await this.bucketKey(context, request, policy, explicit !== undefined);

    const hit = await this.store.hit(key, policy.ttlMs);
    if (hit.count > policy.limit) {
      this.setRetryAfter(context, hit.resetInMs);
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  private async bucketKey(
    context: ExecutionContext,
    request: ThrottleRequest,
    policy: ThrottleRoutePolicy,
    explicit: boolean,
  ): Promise<string> {
    const ip = request.ip ?? 'unknown';
    // Routes with their own policy get their own bucket per handler, so two never share one.
    // Unmarked routes share one bucket per (method class, client): all reads together, all
    // intents together.
    const scope = explicit
      ? `${context.getClass().name}.${context.getHandler().name}`
      : isReadMethod(request.method)
        ? 'read'
        : 'intent';
    if (policy.key === 'ip+email') return `${scope}|${ip}|${emailKey(request)}`;
    if (policy.key === 'account') {
      const account = await this.accountOf(request);
      return `${scope}|${account !== undefined ? `acct:${account}` : `ip:${ip}`}`;
    }
    return `${scope}|${ip}`;
  }

  private async accountOf(request: ThrottleRequest): Promise<string | undefined> {
    if (this.tokens === undefined) return undefined;
    const header = request.headers?.authorization;
    if (header === undefined) return undefined;
    const separator = header.indexOf(' ');
    if (separator === -1 || header.slice(0, separator).toLowerCase() !== 'bearer') return undefined;
    try {
      return (await this.tokens.verifyAccessToken(header.slice(separator + 1).trim())).accountId;
    } catch {
      return undefined;
    }
  }

  private setRetryAfter(context: ExecutionContext, msUntilReset: number): void {
    const response = context
      .switchToHttp()
      .getResponse<{ setHeader(name: string, value: string): void }>();
    response.setHeader('Retry-After', String(Math.max(1, Math.ceil(msUntilReset / 1000))));
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
