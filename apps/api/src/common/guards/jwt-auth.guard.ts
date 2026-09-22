import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InvalidAccessTokenError, TokenService } from '../../auth/token.service.js';
import type { CurrentUserPayload } from '../decorators/current-user.decorator.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

const BEARER_PREFIX = 'Bearer ';

// Global guard (registered as APP_GUARD in app.module.ts, after ThrottlerGuard, R28): every
// route is authenticated by default, except one marked @Public(). Stateless by design (R29):
// verifies the access JWT via TokenService only, no Prisma lookup, so a banned account's
// outstanding access tokens are accepted until they expire naturally (ban status is re-checked
// at login/refresh, S2.3) — do not add a database call here.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ headers: { authorization?: string }; user?: CurrentUserPayload }>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) throw new UnauthorizedException('missing bearer access token');

    try {
      const claims = await this.tokenService.verifyAccessToken(token);
      request.user = { accountId: claims.accountId, playerId: claims.playerId, role: claims.role };
      return true;
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        throw new UnauthorizedException('invalid or expired access token');
      }
      throw error;
    }
  }
}

function extractBearerToken(header: string | undefined): string | undefined {
  if (!header?.startsWith(BEARER_PREFIX)) return undefined;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : undefined;
}
