import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import {
  ReportsService,
  type ReportListResponse,
  type ReportResponse,
} from './reports.service.js';

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports')
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
  ): Promise<ReportListResponse> {
    return this.reports.list(user.playerId, limit, cursor);
  }

  @Get('reports/:missionId')
  report(
    @CurrentUser() user: CurrentUserPayload,
    @Param('missionId') missionId: string,
    @Query('view') view: string | undefined,
    @Query('locale') locale: string | undefined,
  ): Promise<ReportResponse> {
    return this.reports.report(user.playerId, missionId, view, locale);
  }
}
