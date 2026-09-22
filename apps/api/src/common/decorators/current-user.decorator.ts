import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AccountRole } from '../../auth/token.service.js';

// Shape JwtAuthGuard attaches to `request.user` from the access token's sub/pid/role claims
// (S2.2 TokenService.verifyAccessToken). S2.3's controllers and every later authenticated route
// read exactly this shape via @CurrentUser().
export interface CurrentUserPayload {
  accountId: string;
  playerId: string;
  role: AccountRole;
}

// Exported separately from the decorator factory so it can be unit-tested directly, without
// going through Nest's param-decorator execution pipeline.
export function extractCurrentUser(_data: unknown, context: ExecutionContext): CurrentUserPayload {
  const request = context.switchToHttp().getRequest<{ user?: CurrentUserPayload }>();
  if (!request.user) {
    throw new Error('@CurrentUser() used on a route JwtAuthGuard did not run for');
  }
  return request.user;
}

export const CurrentUser = createParamDecorator(extractCurrentUser);
