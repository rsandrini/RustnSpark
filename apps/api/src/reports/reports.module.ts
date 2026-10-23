import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { ReportTemplateStore } from './templates/template.store.js';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, ReportTemplateStore],
  exports: [ReportsService, ReportTemplateStore],
})
export class ReportsModule {}
