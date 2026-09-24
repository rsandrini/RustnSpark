import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { OwnedResource } from '../common/decorators/owned-resource.decorator.js';
import { OwnershipGuard } from '../common/guards/ownership.guard.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { RepairDto } from './dto/repair.dto.js';
import { RepairService, type StoredTarget } from './repair.service.js';

@Controller('ships')
export class RepairController {
  constructor(private readonly repair: RepairService) {}

  @Post(':id/repair')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'ship', param: 'id' })
  repairShip(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') shipId: string,
    @Body() dto: RepairDto,
  ): Promise<{
    repairJobId: string;
    shipId: string;
    cost: number;
    durationSeconds: number;
    completesAt: Date;
    targets: StoredTarget[];
  }> {
    return this.repair.start(shipId, user.playerId, dto.targets);
  }
}
