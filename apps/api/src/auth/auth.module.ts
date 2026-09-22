import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { TokenService } from './token.service.js';

// PrismaModule/EnvModule are global, so only the auth services need declaring here. TokenService
// is also provided on AppModule for the global JwtAuthGuard; a second instance here is harmless
// because the service is stateless (see the note in app.module.ts).
@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, RefreshTokenService, TokenService],
  exports: [AuthService],
})
export class AuthModule {}
