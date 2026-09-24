import { Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { OwnedResource } from '../common/decorators/owned-resource.decorator.js';
import { OwnershipGuard } from '../common/guards/ownership.guard.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import type { RescueResponse } from './rescue.service.js';
import { RescueService } from './rescue.service.js';

@Controller('ships')
export class RescueController {
  constructor(private readonly rescue: RescueService) {}

  @Post(':id/rescue')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'ship', param: 'id' })
  rescueShip(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') shipId: string,
  ): Promise<RescueResponse> {
    return this.rescue.rescue(shipId, user.playerId);
  }
}
