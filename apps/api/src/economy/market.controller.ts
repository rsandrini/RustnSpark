import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { BuyDto, SellDto } from './dto/market.dto.js';
import { MarketService } from './market.service.js';

@Controller()
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get('locations/:id/market')
  marketBoard(@CurrentUser() user: CurrentUserPayload, @Param('id') locationId: string) {
    return this.market.market(locationId, user.playerId);
  }

  @Post('market/buy')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  buy(@CurrentUser() user: CurrentUserPayload, @Body() dto: BuyDto) {
    return this.market.buy(user.playerId, dto.listingId, dto.expectedPrice);
  }

  @Post('market/sell')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  sell(@CurrentUser() user: CurrentUserPayload, @Body() dto: SellDto) {
    return this.market.sell(user.playerId, dto.partInstanceId, dto.expectedPrice);
  }
}
