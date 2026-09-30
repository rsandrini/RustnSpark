import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { Clock } from '../common/clock/clock.js';
import { EnvModule, EnvService } from '../common/env/env.module.js';
import { ConfigModule } from '../config/config.module.js';
import { PartsModule } from '../parts/parts.module.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { WalletService } from '../players/wallet.service.js';
import { REPAIR_QUEUE_NAME, bullConnectionOptions } from '../jobs/queues.js';
import { InventoryService } from './inventory.service.js';
import { MarketController } from './market.controller.js';
import { MarketService } from './market.service.js';
import { MaterialsController } from './materials.controller.js';
import { MaterialsService } from './materials.service.js';
import { PartUpgradeController } from './part-upgrade.controller.js';
import { PartUpgradeService } from './part-upgrade.service.js';
import { PricingService } from './pricing.service.js';
import { RepairController } from './repair.controller.js';
import { RepairService } from './repair.service.js';
import { RefuelController } from './refuel.controller.js';
import { RefuelService } from './refuel.service.js';
import { RescueController } from './rescue.controller.js';
import { RescueService } from './rescue.service.js';
import { ScavengingController } from './scavenging.controller.js';
import { ScavengingService } from './scavenging.service.js';

// S8.1-S8.7: pricing, market HTTP, instant refuel, the repair job producer, free
// scavenging, auto-rescue and the materials market live here. Wallet/PlayerEvent are
// provided directly (same pattern as MissionsModule) so the worker graph can also
// provide RepairService without pulling PlayersModule's controllers.
@Module({
  imports: [
    ConfigModule,
    PartsModule,
    EnvModule,
    BullModule.forRootAsync({
      imports: [EnvModule],
      inject: [EnvService],
      useFactory: (env: EnvService) => ({
        connection: bullConnectionOptions(env.get('REDIS_URL')),
      }),
    }),
    BullModule.registerQueue({ name: REPAIR_QUEUE_NAME }),
  ],
  controllers: [
    MarketController,
    MaterialsController,
    RepairController,
    RefuelController,
    RescueController,
    ScavengingController,
    PartUpgradeController,
  ],
  providers: [
    PricingService,
    MarketService,
    MaterialsService,
    RepairService,
    RefuelService,
    RescueService,
    InventoryService,
    ScavengingService,
    PartUpgradeService,
    WalletService,
    PlayerEventService,
    Clock,
  ],
  exports: [PricingService, MarketService, RepairService],
})
export class EconomyModule {}
