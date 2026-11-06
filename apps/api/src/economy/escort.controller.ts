import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { OwnedResource } from '../common/decorators/owned-resource.decorator.js';
import { OwnershipGuard } from '../common/guards/ownership.guard.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { EscortService, type EscortInfo } from './escort.service.js';

@Controller('ships')
export class EscortController {
  constructor(private readonly escort: EscortService) {}

  // What the escort offers now (and docks the ship when its transport has arrived).
  @Get(':id/escort')
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'ship', param: 'id' })
  info(@CurrentUser() user: CurrentUserPayload, @Param('id') shipId: string): Promise<EscortInfo> {
    return this.escort.info(shipId, user.playerId);
  }

  // The pilot accepts the escort: the ship leaves for the nearest safe port.
  @Post(':id/escort')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'ship', param: 'id' })
  start(@CurrentUser() user: CurrentUserPayload, @Param('id') shipId: string): Promise<EscortInfo> {
    return this.escort.start(shipId, user.playerId);
  }
}
