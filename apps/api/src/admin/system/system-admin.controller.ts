import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SystemFlag, SystemNotice } from '@prisma/client';
import { AdminGuard } from '../guards/admin.guard.js';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../common/decorators/current-user.decorator.js';
import { CreateNoticeDto, SetFlagDto } from './dto/index.js';
import { SystemFlagService } from './system-flag.service.js';
import { SystemNoticeService } from './system-notice.service.js';

// Screen E admin controls (GDD §17): flags, maintenance and broadcast. Every write here
// is a non-tuning admin write and lands in AdminAuditLog (S11.1) with the request's IP.
@UseGuards(AdminGuard)
@Controller('admin/system')
export class SystemAdminController {
  constructor(
    private readonly flags: SystemFlagService,
    private readonly notices: SystemNoticeService,
  ) {}

  @Get('flags')
  listFlags(): Promise<SystemFlag[]> {
    return this.flags.list();
  }

  @Put('flags/:key')
  async setFlag(
    @Param('key') key: string,
    @Body() dto: SetFlagDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: Request,
  ): Promise<SystemFlag> {
    const normalized = key.trim();
    if (normalized.length === 0) throw new BadRequestException('flag key required');
    return this.flags.setFlag(normalized, dto.value, {
      actor: user.accountId,
      ip: request.ip ?? null,
    });
  }

  @Get('notices')
  listNotices(): Promise<SystemNotice[]> {
    return this.notices.list();
  }

  @Post('notices')
  async createNotice(
    @Body() dto: CreateNoticeDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: Request,
  ): Promise<SystemNotice> {
    return this.notices.create(dto.message, {
      actor: user.accountId,
      ip: request.ip ?? null,
    });
  }

  @Post('notices/:id/dismiss')
  @HttpCode(200)
  async dismissNotice(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: Request,
  ): Promise<SystemNotice> {
    return this.notices.dismiss(id, {
      actor: user.accountId,
      ip: request.ip ?? null,
    });
  }
}
