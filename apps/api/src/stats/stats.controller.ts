import { Controller, Get, Param } from '@nestjs/common';
import type { MyStatsResponse, PublicProfileResponse } from '@rustandspark/contract';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { ProfileService } from './profile.service.js';

// No @Public(): the global JwtAuthGuard's default-deny applies. The card is any signed-in
// pilot's to read, so the name in the path needs no ownership check; the private numbers are
// only ever served for the caller's own id from the token.
@Controller('players')
export class StatsController {
  constructor(private readonly profiles: ProfileService) {}

  @Get('me/stats')
  mine(@CurrentUser() user: CurrentUserPayload): Promise<MyStatsResponse> {
    return this.profiles.mine(user.playerId);
  }

  @Get('by-name/:name/profile')
  card(@Param('name') name: string): Promise<PublicProfileResponse> {
    return this.profiles.publicCard(name);
  }
}
