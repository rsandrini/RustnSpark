import { Module } from '@nestjs/common';
import { NameReportController } from './name-report.controller.js';
import { NameReportService } from './name-report.service.js';

@Module({
  controllers: [NameReportController],
  providers: [NameReportService],
})
export class ModerationModule {}
