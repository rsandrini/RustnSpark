import { Module } from '@nestjs/common';

/**
 * Resolution engine wiring (S5.9). The pure resolvers live in `combat/`,
 * `encounter/`, `wear/`, `leg/`, `mission/`, etc. and must never import I/O
 * (`@prisma/client`, `@nestjs/*`, `bullmq`) — ESLint exempts only this
 * `*.module.ts` file from that rule. Worker/DB consumers arrive in S7.3.
 */
@Module({})
export class ResolutionModule {}
