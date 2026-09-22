import { Module } from '@nestjs/common';
import { EnvModule } from './common/env/env.module.js';

@Module({ imports: [EnvModule] })
export class AppModule {}
