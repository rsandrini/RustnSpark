import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { AccountRole } from '@prisma/client';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';

// Runs after JwtAuthGuard (controller-level, S3.6): request.user is already populated.
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: CurrentUserPayload }>();
    if (request.user?.role === AccountRole.ADMIN) return true;
    throw new ForbiddenException('admin access required');
  }
}
