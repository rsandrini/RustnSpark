import { Module } from '@nestjs/common';
import { EnvModule } from './common/env/env.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({ imports: [EnvModule, PrismaModule] })
export class AppModule {}
