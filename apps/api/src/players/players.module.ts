import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { ShipsModule } from '../ships/ships.module.js';
import { PlayerEventService } from './player-event.service.js';
import { PlayersController } from './players.controller.js';
import { PlayersService } from './players.service.js';
import { WalletService } from './wallet.service.js';
import { OnboardingService } from './onboarding.service.js';

// R27: WalletService and PlayerEventService live in this module as providers AND exports —
// Step 3+ game logic consumes them from here. OnboardingService needs ConfigModule and ShipsModule;
// the S11.4 admin reset re-runs the exact starter path via its exported applyStarterKit.
@Module({
  imports: [ConfigModule, ShipsModule],
  controllers: [PlayersController],
  providers: [PlayersService, WalletService, PlayerEventService, OnboardingService],
  exports: [WalletService, PlayerEventService, OnboardingService],
})
export class PlayersModule {}
