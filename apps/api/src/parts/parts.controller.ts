import { Controller, Get, Query } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { parseLocale } from '../common/locale/locale.js';
import { PartsService, type CatalogItem, type InventoryItem } from './parts.service.js';

@Controller()
export class PartsController {
  constructor(private readonly partsService: PartsService) {}

  @Get('parts/catalog')
  catalog(@Query('locale') locale: string | undefined): Promise<CatalogItem[]> {
    return this.partsService.catalog(parseLocale(locale));
  }

  @Get('inventory')
  inventory(@CurrentUser() user: CurrentUserPayload): Promise<InventoryItem[]> {
    return this.partsService.inventory(user.playerId);
  }
}
