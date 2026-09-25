import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../guards/admin.guard.js';
import { DashboardService, type DashboardSummary } from './dashboard.service.js';
import { EconomyService, type EconomySummary } from './economy.service.js';
import { WorldService, type WorldSummary } from './world.service.js';
import { parseWindow } from './window.js';

// Screens A–C read endpoints (GDD §17). Reads are not audited — S11.1 covers admin
// writes; a dashboard refresh must stay cheap. Each response echoes the window it
// answered for (first key, then the aggregates) so charts can label their exact range.
interface Windowed<T> {
  readonly window: { readonly from: string; readonly to: string };
  readonly data: T;
}

@UseGuards(AdminGuard)
@Controller('admin/analytics')
export class AnalyticsController {
  constructor(
    private readonly dashboards: DashboardService,
    private readonly economy: EconomyService,
    private readonly world: WorldService,
  ) {}

  @Get('dashboard')
  async getDashboard(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<Windowed<DashboardSummary>> {
    const window = parseWindow(from, to);
    return {
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      data: await this.dashboards.summary(window),
    };
  }

  @Get('economy')
  async getEconomy(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<Windowed<EconomySummary>> {
    const window = parseWindow(from, to);
    return {
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      data: await this.economy.summary(window),
    };
  }

  @Get('world')
  async getWorld(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<Windowed<WorldSummary>> {
    const window = parseWindow(from, to);
    return {
      window: { from: window.from.toISOString(), to: window.to.toISOString() },
      data: await this.world.summary(window),
    };
  }
}
