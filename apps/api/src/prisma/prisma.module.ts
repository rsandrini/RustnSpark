import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

// Global: PrismaService is a shared dependency of every domain module from Step 2 onward.
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
