import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from './guards/admin.guard.js';

// Base controller for every /v1/admin route. The guard composes with the global JwtAuthGuard:
// JWT runs first and attaches request.user; AdminGuard then enforces the ADMIN role (S3.6).
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  @Get('health')
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
