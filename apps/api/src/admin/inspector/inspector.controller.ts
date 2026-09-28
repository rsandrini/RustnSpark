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
import { ReportsService } from '../../reports/reports.service.js';
import { AdminAuditService } from '../audit/admin-audit.service.js';
import { AdminGuard } from '../guards/admin.guard.js';
import { CreditsActionDto, ReasonDto, SetDebugFastOpsDto } from './dto/index.js';
import { InspectorService } from './inspector.service.js';
import { SupportService, type SupportContext } from './support.service.js';

// Screen D admin inspector (GDD §17): player sheet, event timeline, report history +
// replay (S11.4) and the six support actions. Everything behind AdminGuard; every write
// carries the caller's reason into its S11.1 audit row.
@UseGuards(AdminGuard)
@Controller('admin/players')
export class InspectorController {
  constructor(
    private readonly inspector: InspectorService,
    private readonly support: SupportService,
    private readonly reports: ReportsService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  list(@Query('q') q?: string): ReturnType<InspectorService['list']> {
    return this.inspector.list(q);
  }

  // Reading a player's account sheet exposes an email address and the whole wallet, so it leaves
  // a trace like a write does (who looked at whom): support work is accountable both ways.
  @Get(':playerId')
  async sheet(
    @Param('playerId') playerId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: Request,
  ): Promise<Record<string, unknown>> {
    const sheet = await this.inspector.sheet(playerId);
    await this.audit.record({
      actor: user.accountId,
      action: 'PLAYER_SHEET_VIEW',
      target: playerId,
      ip: request.ip ?? null,
    });
    return sheet;
  }

  @Get(':playerId/events')
  timeline(
    @Param('playerId') playerId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): ReturnType<InspectorService['timeline']> {
    return this.inspector.timeline(playerId, limit, cursor);
  }

  @Get(':playerId/reports')
  reportHistory(
    @Param('playerId') playerId: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): ReturnType<ReportsService['list']> {
    return this.reports.list(playerId, limit, cursor);
  }

  @Get(':playerId/reports/:missionId/replay')
  replay(
    @Param('playerId') playerId: string,
    @Param('missionId') missionId: string,
    @Query('view') view?: string,
    @Query('locale') locale?: string,
  ): Promise<Record<string, unknown>> {
    return this.inspector.replayReport(playerId, missionId, view, locale);
  }

  @Post(':playerId/credits/grant')
  @HttpCode(200)
  @Idempotent()
  grantCredits(
    @Param('playerId') playerId: string,
    @Body() dto: CreditsActionDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: Request,
  ): ReturnType<SupportService['grantCredits']> {
    return this.support.grantCredits(playerId, dto.amount, this.context(user, request, dto.reason));
  }

  @Post(':playerId/credits/remove')
  @HttpCode(200)
  @Idempotent()
  removeCredits(
    @Param('playerId') playerId: string,
    @Body() dto: CreditsActionDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: Request,
  ): ReturnType<SupportService['removeCredits']> {
    return this.support.removeCredits(
      playerId,
      dto.amount,
      this.context(user, request, dto.reason),
    );
  }

  @Post(':playerId/clear-balance')
  @HttpCode(200)
  @Idempotent()
  clearBalance(
    @Param('playerId') playerId: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: Request,
  ): ReturnType<SupportService['clearNegativeBalance']> {
    return this.support.clearNegativeBalance(playerId, this.context(user, request, dto.reason));
  }

  @Post(':playerId/ban')
  @HttpCode(200)
  @Idempotent()
  ban(
    @Param('playerId') playerId: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: Request,
  ): ReturnType<SupportService['ban']> {
    return this.support.ban(playerId, this.context(user, request, dto.reason));
  }

  @Post(':playerId/reset')
  @HttpCode(200)
  @Idempotent()
  reset(
    @Param('playerId') playerId: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: Request,
  ): ReturnType<SupportService['reset']> {
    return this.support.reset(playerId, this.context(user, request, dto.reason));
  }

  @Post(':playerId/debug-fast-ops')
  @HttpCode(200)
  @Idempotent()
  setDebugFastOps(
    @Param('playerId') playerId: string,
    @Body() dto: SetDebugFastOpsDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: Request,
  ): ReturnType<SupportService['setDebugFastOps']> {
    return this.support.setDebugFastOps(
      playerId,
      dto.enabled,
      this.context(user, request, dto.reason),
    );
  }

  @Post(':playerId/ships/:shipId/unstick')
  @HttpCode(200)
  @Idempotent()
  unstick(
    @Param('playerId') playerId: string,
    @Param('shipId') shipId: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: Request,
  ): ReturnType<SupportService['unstickShip']> {
    return this.support.unstickShip(playerId, shipId, this.context(user, request, dto.reason));
  }

  private context(user: CurrentUserPayload, request: Request, reason: string): SupportContext {
    return { actor: user.accountId, ip: request.ip ?? null, reason };
  }
}
