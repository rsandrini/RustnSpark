import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Player } from '@prisma/client';
import type { Locale } from '../common/locale/locale.js';
import { REFUEL_EVENT } from '../economy/refuel.service.js';
import { REPAIR_STARTED_EVENT } from '../economy/repair.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

// The public shape of a player's own profile: no account PII (email stays on Account).
// factionId is null until onboarding picks one (S10.2 routes on it client-side).
export interface PlayerProfile {
  id: string;
  name: string;
  credits: number;
  locale: string;
  role: string;
  factionId: string | null;
  /** The newcomer tutorial was skipped or finished (reopening it sets this back to false). */
  tutorialDone: boolean;
}

export function toPlayerProfile(player: Player, role: string): PlayerProfile {
  return {
    id: player.id,
    name: player.name,
    credits: player.credits,
    locale: player.locale,
    role,
    factionId: player.factionId,
    tutorialDone: player.tutorialDone,
  };
}

/** What the pilot has really done that the newcomer checklist asks for, read from the game's own records. */
export interface TutorialProgress {
  /** Paid for fuel at least once. */
  refuelled: boolean;
  /** Paid for a repair at least once. */
  repaired: boolean;
  /** Started a scavenging or mining job at least once. */
  worked: boolean;
  /** Took a mission (accepted it, whatever became of it). */
  missionTaken: boolean;
  /** Sent the ship out on a mission at least once. */
  dispatched: boolean;
}

@Injectable()
export class PlayersService {
  constructor(private readonly prisma: PrismaService) {}

  // The JWT guard is stateless (R29), so a valid token can reference a deleted player: 404.
  async getProfile(playerId: string): Promise<PlayerProfile> {
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { account: { select: { role: true } } },
    });
    if (!player || !player.account) throw new NotFoundException('player not found');
    return toPlayerProfile(player, player.account.role);
  }

  /** The checklist's action steps, from the player's own records (so they survive a cleared browser or a new device). */
  async getTutorialProgress(playerId: string): Promise<TutorialProgress> {
    const [refuels, repairs, jobs, taken, flown] = await Promise.all([
      this.prisma.playerEvent.count({ where: { playerId, type: REFUEL_EVENT } }),
      this.prisma.playerEvent.count({ where: { playerId, type: REPAIR_STARTED_EVENT } }),
      this.prisma.missionInstance.count({
        where: { playerId, type: { in: ['SCAVENGE', 'MINING'] } },
      }),
      // a mission taken: still held by the pilot in a state past the board (a backed-out one is back on the board)
      this.prisma.missionInstance.count({
        where: {
          playerId,
          type: { notIn: ['SCAVENGE', 'MINING', 'TRAVEL'] },
          status: { notIn: ['AVAILABLE', 'HELD', 'EXPIRED'] },
        },
      }),
      // a flight: dispatch stamps the arrival time
      this.prisma.missionInstance.count({
        where: {
          playerId,
          type: { notIn: ['SCAVENGE', 'MINING', 'TRAVEL'] },
          arrivalAt: { not: null },
        },
      }),
    ]);
    return {
      refuelled: refuels > 0,
      repaired: repairs > 0,
      worked: jobs > 0,
      missionTaken: taken > 0,
      dispatched: flown > 0,
    };
  }

  async updateLocale(playerId: string, locale: Locale): Promise<PlayerProfile> {
    return this.updatePlayer(playerId, { locale });
  }

  async updateTutorial(playerId: string, done: boolean): Promise<PlayerProfile> {
    return this.updatePlayer(playerId, { tutorialDone: done });
  }

  private async updatePlayer(
    playerId: string,
    data: Prisma.PlayerUpdateInput,
  ): Promise<PlayerProfile> {
    try {
      const player = await this.prisma.player.update({
        where: { id: playerId },
        data,
        include: { account: { select: { role: true } } },
      });
      return toPlayerProfile(player, player.account.role);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('player not found');
      }
      throw error;
    }
  }
}
