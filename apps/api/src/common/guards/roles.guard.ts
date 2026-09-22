import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AccountRole } from '../../auth/token.service.js';
import type { CurrentUserPayload } from '../decorators/current-user.decorator.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

// Applied per-route via @UseGuards(RolesGuard), never global (R28): only routes that declare
// @Roles(...) need it (admin-only endpoints, Step 11). Runs after JwtAuthGuard, which already
// attached request.user, so this only ever compares roles, never verifies the token itself.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AccountRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: CurrentUserPayload }>();
    const role = request.user?.role;
    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException('insufficient role for this route');
    }
    return true;
  }
}
