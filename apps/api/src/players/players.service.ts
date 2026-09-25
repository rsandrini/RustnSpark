import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Player } from '@prisma/client';
import type { Locale } from '../common/locale/locale.js';
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
}

export function toPlayerProfile(player: Player, role: string): PlayerProfile {
  return {
    id: player.id,
    name: player.name,
    credits: player.credits,
    locale: player.locale,
    role,
    factionId: player.factionId,
  };
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

  async updateLocale(playerId: string, locale: Locale): Promise<PlayerProfile> {
    try {
      const player = await this.prisma.player.update({
        where: { id: playerId },
        data: { locale },
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
