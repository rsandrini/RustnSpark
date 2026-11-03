import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { ThrottleRoute } from '../common/decorators/throttle-route.decorator.js';
import { NAME_REPORT_POLICY } from '../common/throttling/policies.js';
import { NameReportDto } from './dto/name-report.dto.js';
import { NameReportService } from './name-report.service.js';

@Controller('moderation')
export class NameReportController {
  constructor(private readonly reports: NameReportService) {}

  // A pilot reports another pilot's ship name or pilot name; an admin reviews it (admin/moderation).
  @Post('reports')
  @ThrottleRoute(NAME_REPORT_POLICY)
  @HttpCode(HttpStatus.CREATED)
  report(@CurrentUser() user: CurrentUserPayload, @Body() dto: NameReportDto) {
    return this.reports.create(user.playerId, dto);
  }
}
