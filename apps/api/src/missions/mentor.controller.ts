import { Controller, Get } from '@nestjs/common';
import type { Mentor } from './giver-types.js';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GiversService } from './givers.service.js';

// Like the rest of /players/me, no @Public(): the token names the player.
@Controller('players/me')
export class MentorController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly givers: GiversService,
  ) {}

  /** The pilot's faction mentor and what they say in the Getting started card; null before a faction is chosen. */
  @Get('mentor')
  async getMentor(@CurrentUser() user: CurrentUserPayload): Promise<Mentor | null> {
    const player = await this.prisma.player.findUnique({
      where: { id: user.playerId },
      select: { factionId: true },
    });
    if (player?.factionId === null || player === null) return null;
    return this.givers.mentorOf(player.factionId);
  }
}
