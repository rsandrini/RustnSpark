import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { CurrentUserPayload } from '../decorators/current-user.decorator.js';
import { AccountStatusCache } from './account-status.cache.js';

// Ends the R29 window: a ban used to bite only at login/refresh, so a banned player kept playing
// with their access token for up to its whole lifetime. Registered after JwtAuthGuard (needs
// request.user). JwtAuthGuard itself stays stateless; the primary-key lookup lives in the cache.
@Injectable()
export class AccountStatusGuard implements CanActivate {
  constructor(private readonly accounts: AccountStatusCache) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: CurrentUserPayload }>();
    const user = request.user;
    if (user === undefined) return true; // @Public() route: nothing to check
    if (await this.accounts.isActive(user.accountId)) return true;
    throw new ForbiddenException({ error: 'ACCOUNT_BANNED' });
  }
}
