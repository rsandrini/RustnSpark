import { Module } from '@nestjs/common';
import { PlayerEventService } from './player-event.service.js';
import { PlayersController } from './players.controller.js';
import { PlayersService } from './players.service.js';
import { WalletService } from './wallet.service.js';

// R27: WalletService and PlayerEventService live in this module as providers AND exports —
// Step 3+ game logic consumes them from here. The controller and its routes stay untouched.
@Module({
  controllers: [PlayersController],
  providers: [PlayersService, WalletService, PlayerEventService],
  exports: [WalletService, PlayerEventService],
})
export class PlayersModule {}
