import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { UpdateLocaleDto } from './dto/update-locale.dto.js';
import { PlayersService, type PlayerProfile } from './players.service.js';

// No @Public() anywhere here: the global JwtAuthGuard's default-deny applies (R28), and the
// player is identified by the token claims rather than a path param (no OwnershipGuard needed).
@Controller('players')
export class PlayersController {
  constructor(private readonly playersService: PlayersService) {}

  @Get('me')
  getMe(@CurrentUser() user: CurrentUserPayload): Promise<PlayerProfile> {
    return this.playersService.getProfile(user.playerId);
  }

  @Post('me/locale')
  @HttpCode(200)
  updateLocale(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateLocaleDto,
  ): Promise<PlayerProfile> {
    return this.playersService.updateLocale(user.playerId, dto.locale);
  }
}
