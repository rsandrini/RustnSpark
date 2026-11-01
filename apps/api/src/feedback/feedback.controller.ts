import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { ThrottleRoute } from '../common/decorators/throttle-route.decorator.js';
import { BUG_REPORT_POLICY } from '../common/throttling/policies.js';
import { BugReportDto } from './dto/bug-report.dto.js';
import { FeedbackService } from './feedback.service.js';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  // Beta bug report: signed-in players only (the global JwtAuthGuard), a few per minute and a few per
  // day per account, emailed to the owner through Resend.
  @Post('bug')
  @ThrottleRoute(BUG_REPORT_POLICY)
  @HttpCode(HttpStatus.NO_CONTENT)
  async reportBug(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: BugReportDto,
  ): Promise<void> {
    await this.feedback.sendBugReport(user.accountId, user.playerId, dto);
  }
}
