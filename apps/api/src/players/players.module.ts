import { Module } from '@nestjs/common';
import { PlayersController } from './players.controller.js';
import { PlayersService } from './players.service.js';

// R27: deliberately minimal — S2.5 adds WalletService/PlayerEventService to this same module
// (providers only); the controller and its routes stay untouched.
@Module({
  controllers: [PlayersController],
  providers: [PlayersService],
})
export class PlayersModule {}
