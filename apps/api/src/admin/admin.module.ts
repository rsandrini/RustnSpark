import { Module } from '@nestjs/common';
import { PasswordService } from '../auth/password.service.js';
import { ConfigModule } from '../config/config.module.js';
import { PlayersModule } from '../players/players.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { AccountStatusCache } from '../common/guards/account-status.cache.js';
import { AdminController } from './admin.controller.js';
import { AdminAuditService } from './audit/admin-audit.service.js';
import { AdminGuard } from './guards/admin.guard.js';
import { AnalyticsController } from './analytics/analytics.controller.js';
import { DashboardService } from './analytics/dashboard.service.js';
import { EconomyService } from './analytics/economy.service.js';
import { WorldService } from './analytics/world.service.js';
import { InspectorController } from './inspector/inspector.controller.js';
import { InspectorService } from './inspector/inspector.service.js';
import { ReplayService } from './inspector/replay.service.js';
import { SupportService } from './inspector/support.service.js';
import { SystemAdminController } from './system/system-admin.controller.js';
import { SystemFlagService } from './system/system-flag.service.js';
import { SystemNoticeService } from './system/system-notice.service.js';
import { SystemPublicController } from './system/system-public.controller.js';
import { BundleService } from './tuning/bundle.service.js';
import { ConfigReferenceValidator } from './tuning/config-reference.validator.js';
import { ConfigTuningController } from './tuning/config-tuning.controller.js';
import { ConfigTuningService } from './tuning/config-tuning.service.js';
import { EntityTuningController } from './tuning/entity-tuning.controller.js';
import { EntityTuningService } from './tuning/entity-tuning.service.js';
import { RevisionService } from './tuning/revision.service.js';

// PlayersModule (wallet, onboarding starter path) and ReportsService (render, cursor
// helpers) feed the S11.4 inspector; neither imports this module back, so no cycle.
@Module({
  imports: [ConfigModule, PlayersModule, ReportsModule],
  controllers: [
    AdminController,
    ConfigTuningController,
    EntityTuningController,
    SystemAdminController,
    SystemPublicController,
    AnalyticsController,
    InspectorController,
  ],
  providers: [
    AdminGuard,
    AdminAuditService,
    SystemFlagService,
    SystemNoticeService,
    ConfigReferenceValidator,
    ConfigTuningService,
    EntityTuningService,
    RevisionService,
    BundleService,
    DashboardService,
    EconomyService,
    WorldService,
    ReplayService,
    SupportService,
    InspectorService,
    AccountStatusCache,
    // A second instance of a stateless service (own only dep is the @Global EnvService):
    // AdminModule cannot import AuthModule (AuthModule already imports AdminModule).
    PasswordService,
  ],
  // Consumed outside this module: AuthController gates register.open on SystemFlagService,
  // the global MaintenanceGuard reads the maintenance flag, and S11.4's support actions
  // write audit rows — all without importing each other's modules (no cycles).
  exports: [AdminAuditService, SystemFlagService, SystemNoticeService, AccountStatusCache],
})
export class AdminModule {}
