import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminModule } from '../admin/admin.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { TokenService } from './token.service.js';
import { EmailModule } from '../email/email.module.js';

// PrismaModule/EnvModule are global, so only the auth services need declaring here. TokenService
// is also provided on AppModule for the global JwtAuthGuard; a second instance here is harmless
// because the service is stateless (see the note in app.module.ts).
// AdminModule is imported for SystemFlagService only: register gates on the `register.open`
// feature flag (S11.2). It exports services, not auth dependencies, so no cycle forms.
@Module({
  imports: [AdminModule, EmailModule, ConfigModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, RefreshTokenService, TokenService],
  exports: [AuthService],
})
export class AuthModule {}
