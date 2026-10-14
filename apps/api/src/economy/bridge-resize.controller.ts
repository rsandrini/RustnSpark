import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import {
  BridgeResizeService,
  type BridgeResizeQuote,
  type BridgeResizeResult,
} from './bridge-resize.service.js';

@Controller('parts')
export class BridgeResizeController {
  constructor(private readonly bridges: BridgeResizeService) {}

  @Post(':id/expand/quote')
  @HttpCode(HttpStatus.OK)
  quoteExpand(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') partInstanceId: string,
  ): Promise<BridgeResizeQuote> {
    return this.bridges.quote(user.playerId, partInstanceId, 'expand');
  }

  @Post(':id/expand')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  expand(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') partInstanceId: string,
  ): Promise<BridgeResizeResult> {
    return this.bridges.resize(user.playerId, partInstanceId, 'expand');
  }

  @Post(':id/shrink/quote')
  @HttpCode(HttpStatus.OK)
  quoteShrink(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') partInstanceId: string,
  ): Promise<BridgeResizeQuote> {
    return this.bridges.quote(user.playerId, partInstanceId, 'shrink');
  }

  @Post(':id/shrink')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  shrink(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') partInstanceId: string,
  ): Promise<BridgeResizeResult> {
    return this.bridges.resize(user.playerId, partInstanceId, 'shrink');
  }
}
