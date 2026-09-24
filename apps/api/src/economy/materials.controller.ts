import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { SellMaterialDto } from './dto/market.dto.js';
import { MaterialsService } from './materials.service.js';

@Controller()
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Get('materials')
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.materials.list(user.playerId);
  }

  @Post('market/sell-material')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  sell(@CurrentUser() user: CurrentUserPayload, @Body() dto: SellMaterialDto) {
    return this.materials.sell(user.playerId, dto.materialId, dto.quantity, dto.expectedPrice);
  }
}
