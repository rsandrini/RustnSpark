import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { OwnedResource } from '../common/decorators/owned-resource.decorator.js';
import { OwnershipGuard } from '../common/guards/ownership.guard.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import type { RescueMode, RescueResponse } from './rescue.service.js';
import { RescueService } from './rescue.service.js';

export class RescueDto {
  @IsIn(['now', 'wait'])
  mode!: RescueMode;
}

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
    @Body() dto: RescueDto,
  ): Promise<RescueResponse> {
    return this.rescue.rescue(shipId, user.playerId, dto.mode);
  }

  // A waiting rescue arrives when its time is up; whoever looks first settles it (no-op before).
  @Post(':id/rescue/settle')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'ship', param: 'id' })
  settle(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') shipId: string,
  ): Promise<RescueResponse> {
    return this.rescue.settle(shipId, user.playerId);
  }
}
