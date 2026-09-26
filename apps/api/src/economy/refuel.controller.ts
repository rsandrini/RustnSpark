import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { OwnedResource } from '../common/decorators/owned-resource.decorator.js';
import { OwnershipGuard } from '../common/guards/ownership.guard.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { RefuelDto } from './dto/refuel.dto.js';
import { RefuelService } from './refuel.service.js';

@Controller('ships')
export class RefuelController {
  constructor(private readonly refuel: RefuelService) {}

  @Post(':id/refuel/quote')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'ship', param: 'id' })
  quoteRefuel(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') shipId: string,
    @Body() dto: RefuelDto,
  ) {
    return this.refuel.quote(shipId, user.playerId, dto.mode, dto.amount);
  }

  @Post(':id/refuel')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'ship', param: 'id' })
  refuelShip(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') shipId: string,
    @Body() dto: RefuelDto,
  ): Promise<{
    shipId: string;
    units: number;
    cost: number;
    fuel: number;
    fuelCap: number;
    credits: number;
  }> {
    return this.refuel.refuel(shipId, user.playerId, dto.mode, dto.amount);
  }
}
