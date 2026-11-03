import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../common/decorators/current-user.decorator.js';
import { Idempotent } from '../../common/idempotency/idempotent.decorator.js';
import { AdminGuard } from '../guards/admin.guard.js';
import { ReviewReportDto } from './dto/review-report.dto.js';
import { ModerationAdminService, type ReportStatusFilter } from './moderation-admin.service.js';

const STATUS_FILTERS: readonly ReportStatusFilter[] = ['OPEN', 'DISMISSED', 'ACTIONED', 'ALL'];

// Name reports pilots filed, for a human to review. Behind AdminGuard; every decision is audited.
@UseGuards(AdminGuard)
@Controller('admin/moderation')
export class ModerationAdminController {
  constructor(private readonly moderation: ModerationAdminService) {}

  @Get('reports')
  list(@Query('status') status?: string) {
    const filter = STATUS_FILTERS.find((entry) => entry === status) ?? 'OPEN';
    return this.moderation.list(filter);
  }

  @Post('reports/:id/review')
  @HttpCode(200)
  @Idempotent()
  review(
    @Param('id') id: string,
    @Body() dto: ReviewReportDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: Request,
  ) {
    return this.moderation.review(id, dto.action, dto.note, {
      actor: user.accountId,
      ip: request.ip ?? null,
    });
  }
}
