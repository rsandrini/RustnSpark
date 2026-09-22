import { describe, expect, it } from '@jest/globals';
import {
  BadRequestException,
  UnauthorizedException,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import type { CurrentUserPayload } from '../decorators/current-user.decorator.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { IDEMPOTENT_KEY } from './idempotent.decorator.js';
import {
  IdempotencyInterceptor,
  extractIdempotencyKey,
  hashRequestBody,
} from './idempotency.interceptor.js';

const user: CurrentUserPayload = { accountId: 'account-1', playerId: 'player-1', role: 'PLAYER' };

function makeContext(handler: () => unknown, request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ statusCode: 201 }),
    }),
    getHandler: () => handler,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function idempotentHandler(): () => void {
  const handler = () => undefined;
  Reflect.defineMetadata(IDEMPOTENT_KEY, true, handler);
  return handler;
}

// The interceptor's pure paths (passthrough, header/user validation) never reach the database,
// so a placeholder PrismaService is enough here; DB-bound behavior is covered by
// test/integration/idempotency.int-spec.ts against real Postgres (no DB mocks, per plan).
const unreachablePrisma = {} as PrismaService;

describe('extractIdempotencyKey', () => {
  it('returns the header value trimmed', () => {
    expect(extractIdempotencyKey('  key-123  ')).toBe('key-123');
  });

  it('accepts the first value of a multi-value header', () => {
    expect(extractIdempotencyKey(['key-a', 'key-b'])).toBe('key-a');
  });

  it.each([undefined, '', '   '])('treats %p as missing', (header) => {
    expect(extractIdempotencyKey(header)).toBeUndefined();
  });
});

describe('hashRequestBody', () => {
  it('is stable across object key ordering, including nested objects', () => {
    const first = hashRequestBody({ a: 1, b: { c: 2, d: [3, 4] } });
    const second = hashRequestBody({ b: { d: [3, 4], c: 2 }, a: 1 });
    expect(first).toBe(second);
  });

  it('differs when any value differs', () => {
    expect(hashRequestBody({ amount: 5 })).not.toBe(hashRequestBody({ amount: 6 }));
  });

  it('keeps array order significant', () => {
    expect(hashRequestBody([1, 2])).not.toBe(hashRequestBody([2, 1]));
  });

  it('treats a missing body as null', () => {
    expect(hashRequestBody(undefined)).toBe(hashRequestBody(null));
  });
});

describe('IdempotencyInterceptor (pure paths)', () => {
  it('passes routes without @Idempotent() straight through', async () => {
    const interceptor = new IdempotencyInterceptor(new Reflector(), unreachablePrisma);
    const context = makeContext(() => undefined, { headers: {}, method: 'POST', path: '/v1/x' });
    const handler: CallHandler = { handle: () => of('handler-result') };

    await expect(firstValueFrom(interceptor.intercept(context, handler))).resolves.toBe(
      'handler-result',
    );
  });

  it('rejects an @Idempotent() route without an Idempotency-Key header with 400', async () => {
    const interceptor = new IdempotencyInterceptor(new Reflector(), unreachablePrisma);
    const context = makeContext(idempotentHandler(), {
      headers: {},
      method: 'POST',
      path: '/v1/x',
      body: {},
      user,
    });
    const handler: CallHandler = { handle: () => of('never') };

    await expect(firstValueFrom(interceptor.intercept(context, handler))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an @Idempotent() route the JwtAuthGuard did not identify with 401', async () => {
    const interceptor = new IdempotencyInterceptor(new Reflector(), unreachablePrisma);
    const context = makeContext(idempotentHandler(), {
      headers: { 'idempotency-key': 'k' },
      method: 'POST',
      path: '/v1/x',
      body: {},
    });
    const handler: CallHandler = { handle: () => of('never') };

    await expect(firstValueFrom(interceptor.intercept(context, handler))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
