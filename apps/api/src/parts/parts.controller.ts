import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { DiscardInventoryDto } from './dto/discard.dto.js';
import {
  PartsService,
  type CatalogDetail,
  type CatalogItem,
  type InventoryItem,
} from './parts.service.js';
import { ScrapPartService, type ScrapQuote, type ScrapResult } from './scrap-part.service.js';

@Controller()
export class PartsController {
  constructor(
    private readonly partsService: PartsService,
    private readonly scrapService: ScrapPartService,
  ) {}

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
  discard(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: DiscardInventoryDto,
  ): Promise<{ discarded: number; scrapSold: number; credits: number }> {
    return this.partsService.discardDamaged(user.playerId, {
      sellScrap: dto.sellScrap === true,
    });
  }

  // Dry run: the range and the odds, never the rolled value (that is fixed per part).
  @Post('inventory/:id/scrap/quote')
  @HttpCode(HttpStatus.OK)
  scrapQuote(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') partInstanceId: string,
  ): Promise<ScrapQuote> {
    return this.scrapService.quote(user.playerId, partInstanceId);
  }

  @Post('inventory/:id/scrap')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  scrap(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') partInstanceId: string,
  ): Promise<ScrapResult> {
    return this.scrapService.scrap(user.playerId, partInstanceId);
  }

  @Get('inventory')
  inventory(@CurrentUser() user: CurrentUserPayload): Promise<InventoryItem[]> {
    return this.partsService.inventory(user.playerId);
  }
}
