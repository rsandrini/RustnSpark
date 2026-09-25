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
import { ReportsService } from '../../reports/reports.service.js';
import { AdminGuard } from '../guards/admin.guard.js';
import { CreditsActionDto, ReasonDto } from './dto/index.js';
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
  ) {}

  @Get()
  list(@Query('q') q?: string): ReturnType<InspectorService['list']> {
    return this.inspector.list(q);
  }

  @Get(':playerId')
  sheet(@Param('playerId') playerId: string): Promise<Record<string, unknown>> {
    return this.inspector.sheet(playerId);
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
  reset(
    @Param('playerId') playerId: string,
    @Body() dto: ReasonDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() request: Request,
  ): ReturnType<SupportService['reset']> {
    return this.support.reset(playerId, this.context(user, request, dto.reason));
  }

  @Post(':playerId/ships/:shipId/unstick')
  @HttpCode(200)
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
