import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

// How long an ACTIVE verdict is trusted before the account row is read again: the worst-case
// delay between a ban (on ANOTHER API instance) and the banned player's next request being refused.
export const ACCOUNT_STATUS_TTL_MS = 5_000;

// Per-instance cache of "this account is ACTIVE", so AccountStatusGuard does not cost one query
// per request. The ban action calls forget(), so on the instance that handled it the ban is
// immediate.
@Injectable()
export class AccountStatusCache {
  private readonly active = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  forget(accountId: string): void {
    this.active.delete(accountId);
  }

  async isActive(accountId: string): Promise<boolean> {
    const now = Date.now();
    const trustedUntil = this.active.get(accountId);
    if (trustedUntil !== undefined && trustedUntil > now) return true;
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { status: true },
    });
    // Only an account that EXISTS and is not ACTIVE is refused. A token for a deleted account is
    // not this guard's business: the handler answers it (404 for a missing player), as before.
    if (account !== null && account.status !== 'ACTIVE') {
      this.active.delete(accountId);
      return false;
    }
    this.active.set(accountId, now + ACCOUNT_STATUS_TTL_MS);
    return true;
  }
}
