import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { TravelDto, TravelQuoteQueryDto } from './dto/travel.dto.js';
import { TravelService } from './travel.service.js';

// Travel without a quest: a quote (nothing is created) and the trip itself.
@Controller('travel')
export class TravelController {
  constructor(private readonly travel: TravelService) {}

  @Get('quote')
  quote(@CurrentUser() user: CurrentUserPayload, @Query() query: TravelQuoteQueryDto) {
    return this.travel.quote(user.playerId, query.destinationId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  go(@CurrentUser() user: CurrentUserPayload, @Body() dto: TravelDto) {
    return this.travel.travel(user.playerId, dto.destinationId);
  }
}
