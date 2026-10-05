import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import {
  PartsService,
  type CatalogDetail,
  type CatalogItem,
  type InventoryItem,
} from './parts.service.js';

@Controller()
export class PartsController {
  constructor(private readonly partsService: PartsService) {}

  @Get('parts/catalog')
  catalog(
    @Query('locale') locale: string | undefined,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<CatalogItem[]> {
    return this.partsService.catalogForPlayer(user.playerId, locale);
  }

  @Get('catalog/parts/:partType')
  partDetail(@Param('partType') partType: string): Promise<CatalogDetail> {
    return this.partsService.partDetail(partType);
  }

  @Get('catalog/materials/:id')
  materialDetail(@Param('id') id: string): Promise<CatalogDetail> {
    return this.partsService.materialDetail(id);
  }

  @Post('inventory/discard')
  @HttpCode(HttpStatus.OK)
  discard(@CurrentUser() user: CurrentUserPayload): Promise<{ discarded: number }> {
    return this.partsService.discardDamaged(user.playerId);
  }

  @Get('inventory')
  inventory(@CurrentUser() user: CurrentUserPayload): Promise<InventoryItem[]> {
    return this.partsService.inventory(user.playerId);
  }
}
