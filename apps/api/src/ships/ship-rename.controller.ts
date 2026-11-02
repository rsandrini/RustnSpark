import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { OwnedResource } from '../common/decorators/owned-resource.decorator.js';
import { OwnershipGuard } from '../common/guards/ownership.guard.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { RenameShipDto } from './dto/rename-ship.dto.js';
import { ShipRenameService } from './ship-rename.service.js';

@Controller('ships')
export class ShipRenameController {
  constructor(private readonly renames: ShipRenameService) {}

  // The fixed prefix, the price and the current name, for the rename dialog.
  @Get(':id/rename')
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'ship', param: 'id' })
  quote(@CurrentUser() user: CurrentUserPayload, @Param('id') shipId: string) {
    return this.renames.quote(shipId, user.playerId);
  }

  // Renaming costs credits (economy.ship_rename_price); the faction prefix stays, the rest is the pilot's.
  @Post(':id/rename')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'ship', param: 'id' })
  rename(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') shipId: string,
    @Body() dto: RenameShipDto,
  ) {
    return this.renames.rename(shipId, user.playerId, dto.name);
  }
}
