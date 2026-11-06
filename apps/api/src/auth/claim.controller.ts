import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import type { PlayerProfile } from '../players/players.service.js';
import { setRefreshCookie } from './auth.controller.js';
import { ClaimDto } from './dto/claim.dto.js';
import { GuestService } from './guest.service.js';

// Not @Public(): only a signed-in guest can save the pilot. It sits in the auth module (with the
// guest service) but answers under /players/me, next to the rest of the pilot's own routes.
@Controller('players')
export class ClaimController {
  constructor(private readonly guests: GuestService) {}

  // A guest saves the pilot with an email and password; the pilot, its ship and its money stay.
  @Post('me/claim')
  @HttpCode(200)
  async claim(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ClaimDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ accessToken: string; player: PlayerProfile }> {
    const session = await this.guests.claim(user.accountId, dto);
    setRefreshCookie(response, session);
    return { accessToken: session.accessToken, player: session.player };
  }
}
