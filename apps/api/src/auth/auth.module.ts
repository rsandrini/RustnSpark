import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConfigModule as GameConfigModule } from '../config/config.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GuestService } from './guest.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { TokenService } from './token.service.js';
import { EmailModule } from '../email/email.module.js';
import { StatsModule } from '../stats/stats.module.js';

// PrismaModule/EnvModule are global, so only the auth services need declaring here. TokenService
// is also provided on AppModule for the global JwtAuthGuard; a second instance here is harmless
// because the service is stateless (see the note in app.module.ts).
// AdminModule is imported for SystemFlagService only: register gates on the `register.open`
// feature flag (S11.2). It exports services, not auth dependencies, so no cycle forms.
@Module({
  imports: [StatsModule, AdminModule, EmailModule, ConfigModule, GameConfigModule],
  controllers: [AuthController],
  providers: [AuthService, GuestService, PasswordService, RefreshTokenService, TokenService],
  exports: [AuthService, GuestService],
})
export class AuthModule {}
