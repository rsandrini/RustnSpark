import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module.js';
import { PlayersModule } from '../players/players.module.js';
import { ShipRenameController } from './ship-rename.controller.js';
import { ShipRenameService } from './ship-rename.service.js';

// Its own module: PlayersModule (the wallet) already imports ShipsModule, so the rename cannot live in ShipsModule.
@Module({
  imports: [ConfigModule, PlayersModule],
  controllers: [ShipRenameController],
  providers: [ShipRenameService],
})
export class ShipRenameModule {}
