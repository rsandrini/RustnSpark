import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { PricingService } from '../economy/pricing.service.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { WalletService } from '../players/wallet.service.js';
import { PartsController } from './parts.controller.js';
import { PartsService } from './parts.service.js';

// Wallet/Pricing/PlayerEvent are provided directly (same pattern as EconomyModule and
// MissionsModule) so the discard auto-sell can price and credit in-place; importing
// PlayersModule/EconomyModule here would cycle through ShipsModule -> PartsModule.
@Module({
  imports: [ConfigModule],
  controllers: [PartsController],
  providers: [PartsService, PricingService, WalletService, PlayerEventService],
  exports: [PartsService],
})
export class PartsModule {}
