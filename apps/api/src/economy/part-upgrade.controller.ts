import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import {
  PartUpgradeService,
  type PartUpgradeQuote,
  type PartUpgradeResult,
} from './part-upgrade.service.js';

@Controller('parts')
export class PartUpgradeController {
  constructor(private readonly upgrades: PartUpgradeService) {}

  // Dry run (S10.9-style quote): ownership is checked in the service itself, same as
  // market.sell — a part instance has no separate OwnershipGuard resolver of its own.
  @Post(':id/upgrade/quote')
  @HttpCode(HttpStatus.OK)
  quoteUpgrade(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') partInstanceId: string,
  ): Promise<PartUpgradeQuote> {
    return this.upgrades.quote(user.playerId, partInstanceId);
  }

  @Post(':id/upgrade')
  @HttpCode(HttpStatus.OK)
  @Idempotent()
  upgradePart(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') partInstanceId: string,
  ): Promise<PartUpgradeResult> {
    return this.upgrades.upgrade(user.playerId, partInstanceId);
  }
}
