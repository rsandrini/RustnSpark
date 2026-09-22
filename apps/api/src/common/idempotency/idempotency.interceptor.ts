import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Prisma, type IdempotencyKey } from '@prisma/client';
import { defer, EMPTY, from, throwError, type Observable } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CurrentUserPayload } from '../decorators/current-user.decorator.js';
import { IDEMPOTENT_KEY } from './idempotent.decorator.js';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

// How long a stored response stays replayable; infrastructure retention, not a balance number.
export const IDEMPOTENCY_KEY_TTL_MS = 24 * 60 * 60 * 1000;

// The row is inserted BEFORE the handler runs so a concurrent same-key request loses the PK race
// and gets 409 instead of executing twice (R21). Until the winner stores its response the row
// carries this sentinel; a real HTTP status is always >= 100, so 0 can never be mistaken for one.
const RESPONSE_PENDING_STATUS = 0;

interface IdempotentRequest {
  method: string;
  path?: string;
  route?: { path?: unknown };
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  user?: CurrentUserPayload;
}

interface ReplayableResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): void;
  send(body: string): unknown;
}

type StoredResponse = Pick<IdempotencyKey, 'responseStatus' | 'responseBody'>;

export function extractIdempotencyKey(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? undefined : trimmed;
}

// Key-order-insensitive canonical JSON, so semantically identical bodies hash equal regardless of
// property order (arrays stay order-significant: order is meaningful in a JSON array).
export function hashRequestBody(body: unknown): string {
  return createHash('sha256')
    .update(canonicalize(body ?? null))
    .digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`);
  return `{${entries.join(',')}}`;
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  // Everything (including validation) is deferred into the returned observable: errors surface
  // as observable errors, so Nest's pipeline — and any direct caller — never sees a sync throw.
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(IDEMPOTENT_KEY, context.getHandler())) {
      return next.handle();
    }
    return defer(() => this.prepare(context, next)).pipe(mergeMap((observable) => observable));
  }

  private async prepare(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest<IdempotentRequest>();
    const response = http.getResponse<ReplayableResponse>();

    const key = extractIdempotencyKey(request.headers[IDEMPOTENCY_KEY_HEADER]);
    if (!key) throw new BadRequestException('IDEMPOTENCY_KEY_REQUIRED');
    const user = request.user;
    if (!user) {
      // The global JwtAuthGuard normally answers first; an @Idempotent() route must never be
      // @Public(), because the idempotency record is keyed per player.
      throw new UnauthorizedException('UNAUTHENTICATED');
    }

    const route = resolveRoute(request);
    const requestHash = hashRequestBody(request.body);
    const stored = await this.begin(user.playerId, route, key, requestHash);
    if (stored) {
      // Replay the stored bytes verbatim (R21 byte-stability); EMPTY completes without emitting,
      // so Nest never tries to send a second response over the one written here.
      this.replay(response, stored);
      return EMPTY;
    }

    const statusCode = this.resolveStatusCode(context, request.method);
    return next.handle().pipe(
      mergeMap(async (result: unknown) => {
        const body = result === undefined || result === null ? '' : JSON.stringify(result);
        await this.complete(user.playerId, route, key, statusCode, body);
        return result;
      }),
      catchError((error: unknown) =>
        // A failed execution stores nothing: the pending row is removed so the client's retry
        // with the same key re-executes instead of replaying a failure.
        from(this.abandon(user.playerId, route, key)).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }

  // Returns null when this request won the right to execute, or the completed row to replay.
  private async begin(
    playerId: string,
    route: string,
    key: string,
    requestHash: string,
  ): Promise<StoredResponse | null> {
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { playerId_route_key: { playerId, route, key } },
    });
    if (existing) {
      if (existing.expiresAt.getTime() <= Date.now()) {
        await this.deleteExpired(playerId, route, key);
      } else {
        return this.classifyCompleted(existing, requestHash);
      }
    }

    try {
      await this.prisma.idempotencyKey.create({
        data: {
          key,
          playerId,
          route,
          requestHash,
          responseStatus: RESPONSE_PENDING_STATUS,
          responseBody: '',
          expiresAt: new Date(Date.now() + IDEMPOTENCY_KEY_TTL_MS),
        },
      });
      return null;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      // Lost the PK race (R21): re-read the winner's row. Still pending (or already gone because
      // the winner's handler failed and freed it) → 409; completed → normal replay/mismatch rules.
      const winner = await this.prisma.idempotencyKey.findUnique({
        where: { playerId_route_key: { playerId, route, key } },
      });
      if (!winner || winner.responseStatus === RESPONSE_PENDING_STATUS) {
        throw new ConflictException('IDEMPOTENCY_IN_PROGRESS');
      }
      return this.classifyCompleted(winner, requestHash);
    }
  }

  private classifyCompleted(row: IdempotencyKey, requestHash: string): StoredResponse {
    if (row.responseStatus === RESPONSE_PENDING_STATUS) {
      throw new ConflictException('IDEMPOTENCY_IN_PROGRESS');
    }
    if (row.requestHash !== requestHash) {
      throw new UnprocessableEntityException('IDEMPOTENCY_BODY_MISMATCH');
    }
    return row;
  }

  private async complete(
    playerId: string,
    route: string,
    key: string,
    responseStatus: number,
    responseBody: string,
  ): Promise<void> {
    await this.prisma.idempotencyKey.update({
      where: { playerId_route_key: { playerId, route, key } },
      data: { responseStatus, responseBody },
    });
  }

  private async abandon(playerId: string, route: string, key: string): Promise<void> {
    await this.prisma.idempotencyKey
      .deleteMany({
        where: { playerId, route, key, responseStatus: RESPONSE_PENDING_STATUS },
      })
      // Cleanup must never mask the handler's own error with a cleanup failure.
      .catch(() => undefined);
  }

  private async deleteExpired(playerId: string, route: string, key: string): Promise<void> {
    await this.prisma.idempotencyKey
      .delete({ where: { playerId_route_key: { playerId, route, key } } })
      // A concurrent same-key request may have deleted it first; the create below then decides.
      .catch(() => undefined);
  }

  private replay(response: ReplayableResponse, stored: StoredResponse): void {
    response.status(stored.responseStatus);
    if (stored.responseBody !== '') {
      response.setHeader('content-type', 'application/json; charset=utf-8');
    }
    response.send(stored.responseBody);
  }

  // Mirrors Nest's own rule (router-response-controller): @HttpCode() wins, otherwise POST
  // defaults to 201 and every other method to 200. The response object's statusCode cannot be
  // used here because Nest only applies it after the interceptor's post-phase.
  private resolveStatusCode(context: ExecutionContext, method: string): number {
    const explicit = this.reflector.get<number>(HTTP_CODE_METADATA, context.getHandler());
    if (typeof explicit === 'number') return explicit;
    return method === 'POST' ? 201 : 200;
  }
}

// Prefer the matched route pattern over the concrete URL so path params do not fragment the
// (playerId, route, key) space; fall back to the request path when no pattern is available.
function resolveRoute(request: IdempotentRequest): string {
  const pattern = request.route?.path;
  const path = typeof pattern === 'string' ? pattern : (request.path ?? 'unknown');
  return `${request.method} ${path}`;
}
