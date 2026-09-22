import { describe, expect, it, jest } from '@jest/globals';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InvalidAccessTokenError, type TokenService } from '../../auth/token.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

class DummyController {}

function makeContext(
  authorization: string | undefined,
  isPublic: boolean | undefined,
  request: { headers: { authorization?: string }; user?: unknown } = { headers: {} },
): ExecutionContext {
  function handler() {
    /* stand-in route handler used only as a metadata target */
  }
  if (isPublic !== undefined) {
    Reflect.defineMetadata(IS_PUBLIC_KEY, isPublic, handler);
  }
  request.headers.authorization = authorization;
  return {
    getHandler: () => handler,
    getClass: () => DummyController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeTokenService(
  verifyAccessToken: TokenService['verifyAccessToken'],
): TokenService {
  return { verifyAccessToken } as unknown as TokenService;
}

// Typed wrapper so call sites don't repeat the generic on every jest.fn() call.
function verifyAccessTokenMock(
  implementation?: TokenService['verifyAccessToken'],
): jest.Mock<TokenService['verifyAccessToken']> {
  return implementation ? jest.fn(implementation) : jest.fn();
}

describe('JwtAuthGuard', () => {
  const reflector = new Reflector();

  it('allows a @Public() route through without checking any token', async () => {
    const verifyAccessToken = verifyAccessTokenMock();
    const guard = new JwtAuthGuard(reflector, makeTokenService(verifyAccessToken));
    const context = makeContext(undefined, true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects with 401 when no Authorization header is present', async () => {
    const tokenService = makeTokenService(verifyAccessTokenMock());
    const guard = new JwtAuthGuard(reflector, tokenService);
    const context = makeContext(undefined, false);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects with 401 when the Authorization header is not a Bearer token', async () => {
    const tokenService = makeTokenService(verifyAccessTokenMock());
    const guard = new JwtAuthGuard(reflector, tokenService);
    const context = makeContext('Basic abc123', false);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects with 401 when the Bearer prefix carries no token', async () => {
    const verifyAccessToken = verifyAccessTokenMock();
    const guard = new JwtAuthGuard(reflector, makeTokenService(verifyAccessToken));
    const context = makeContext('Bearer ', false);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the Authorization header has no space-separated token', async () => {
    const verifyAccessToken = verifyAccessTokenMock();
    const guard = new JwtAuthGuard(reflector, makeTokenService(verifyAccessToken));
    const context = makeContext('Bearer', false);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it('accepts the Bearer scheme in any letter case (RFC 7235: schemes are case-insensitive)', async () => {
    const verifyAccessToken = verifyAccessTokenMock(() =>
      Promise.resolve({ accountId: 'acc-1', playerId: 'ply-1', role: 'PLAYER' as const }),
    );
    const guard = new JwtAuthGuard(reflector, makeTokenService(verifyAccessToken));
    const context = makeContext('bEaReR valid.jwt.here', false);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyAccessToken).toHaveBeenCalledWith('valid.jwt.here');
  });

  it('rejects with 401 when TokenService reports an invalid or expired token', async () => {
    const tokenService = makeTokenService(
      verifyAccessTokenMock(() =>
        Promise.reject(new InvalidAccessTokenError(new Error('bad signature'))),
      ),
    );
    const guard = new JwtAuthGuard(reflector, tokenService);
    const context = makeContext('Bearer tampered.jwt.here', false);

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('propagates an unexpected error from TokenService unchanged', async () => {
    const unexpected = new Error('boom');
    const tokenService = makeTokenService(verifyAccessTokenMock(() => Promise.reject(unexpected)));
    const guard = new JwtAuthGuard(reflector, tokenService);
    const context = makeContext('Bearer some.jwt.here', false);

    await expect(guard.canActivate(context)).rejects.toBe(unexpected);
  });

  it('attaches accountId/playerId/role to the request and allows through on a valid token', async () => {
    const request: { headers: { authorization?: string }; user?: unknown } = { headers: {} };
    const tokenService = makeTokenService(
      verifyAccessTokenMock(() =>
        Promise.resolve({ accountId: 'acc-1', playerId: 'ply-1', role: 'PLAYER' as const }),
      ),
    );
    const guard = new JwtAuthGuard(reflector, tokenService);
    const context = makeContext('Bearer valid.jwt.here', false, request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ accountId: 'acc-1', playerId: 'ply-1', role: 'PLAYER' });
  });
});
