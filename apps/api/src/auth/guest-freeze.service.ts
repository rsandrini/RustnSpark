import { Injectable } from '@nestjs/common';
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// A flight under way is never cut off by a freeze: the pilot comes back to its report.
const FLIGHT_STATES = ['ACCEPTED', 'IN_TRANSIT', 'RESOLVING'] as const;

/** Rests the guests nobody claimed and nobody plays: nothing is deleted, they just cannot sign in. */
@Injectable()
export class GuestFreezeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
  ) {}

  /** Freezes unclaimed guests idle longer than `admin.guest_freeze_days`; returns how many were frozen. */
  async freezeIdle(now: Date = new Date()): Promise<number> {
    const days = this.config.snapshot().rules.admin.guest_freeze_days;
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    const result = await this.prisma.account.updateMany({
      where: {
        isGuest: true,
        status: 'ACTIVE',
        player: {
          // never played: judged by when the guest began
          OR: [
            { stats: { lastActiveAt: { lt: cutoff } } },
            { stats: null, account: { createdAt: { lt: cutoff } } },
            { stats: { lastActiveAt: null }, account: { createdAt: { lt: cutoff } } },
          ],
          missions: { none: { status: { in: [...FLIGHT_STATES] } } },
        },
      },
      data: { status: 'FROZEN' },
    });
    return result.count;
  }
}
