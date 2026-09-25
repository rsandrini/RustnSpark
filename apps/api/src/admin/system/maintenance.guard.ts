import {
  Injectable,
  ServiceUnavailableException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { AccountRole } from '@prisma/client';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';
import { MAINTENANCE_FLAG_KEY, SystemFlagService } from './system-flag.service.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// S11.2 maintenance mode: player intents (authenticated mutating requests) answer 503
// while the `maintenance` flag is on. Reads, admins and public routes (login, register,
// refresh — so admins can get in and sessions survive the window) are unaffected.
// Registered as APP_GUARD after JwtAuthGuard (app.module.ts): request.user is populated
// by the time this runs, and the flag is read per request, so toggling it needs no restart.
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly flags: SystemFlagService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ method: string; user?: CurrentUserPayload }>();
    if (!MUTATING_METHODS.has(request.method.toUpperCase())) return true;
    // @Public routes never got a user attached (JwtAuthGuard returns early for them).
    if (request.user === undefined || request.user.role === AccountRole.ADMIN) return true;

    if (await this.flags.isEnabled(MAINTENANCE_FLAG_KEY, false)) {
      throw new ServiceUnavailableException({ error: 'MAINTENANCE' });
    }
    return true;
  }
}
