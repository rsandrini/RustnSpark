import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import {
  ScavengingService,
  type ScavengeInfo,
  type ScavengeResponse,
} from './scavenging.service.js';

// S8.5 free scavenging: no body (the attempt is resolved server-side from the
// world seed), so no DTO; each call is one attempt gated by the per-player
// cooldown — not an idempotency-keyed spend.
@Controller('locations')
export class ScavengingController {
  constructor(private readonly scavenging: ScavengingService) {}

  @Get(':id/scavenge')
  info(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') locationId: string,
  ): Promise<ScavengeInfo> {
    return this.scavenging.info(locationId, user.playerId);
  }

  @Post(':id/scavenge')
  @HttpCode(HttpStatus.OK)
  scavenge(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') locationId: string,
  ): Promise<ScavengeResponse> {
    return this.scavenging.scavenge(locationId, user.playerId);
  }
}
