import { Module } from '@nestjs/common';
import { EnvModule } from '../common/env/env.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { RedisModule } from '../common/redis/redis.module.js';
import { GameConfigRepository } from './game-config.repository.js';
import { GameConfigService } from './game-config.service.js';

@Module({
  imports: [EnvModule, PrismaModule, RedisModule],
  providers: [GameConfigService, GameConfigRepository],
  exports: [GameConfigService, GameConfigRepository],
})
export class ConfigModule {}
