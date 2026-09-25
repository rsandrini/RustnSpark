import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { sumWalletFlows, type WalletFlows } from './analytics.helpers.js';
import { walletFlowRows } from './analytics.queries.js';
import type { AnalyticsWindow } from './window.js';

export type EconomySummary = WalletFlows;

// Screen B data (GDD §17): credits entering vs leaving (inflation) and the sinks breakdown — the
// acceptance question is whether wear (repair + refuel) is the main drain. Grouped in SQL over
// the (type, at) index; support adjustments are reported apart from organic flow.
@Injectable()
export class EconomyService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(window: AnalyticsWindow): Promise<EconomySummary> {
    return sumWalletFlows(await walletFlowRows(this.prisma, window));
  }
}
