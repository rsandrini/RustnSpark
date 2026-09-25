import { Injectable } from '@nestjs/common';
import { WALLET_CREDIT_EVENT, WALLET_DEBIT_EVENT } from '../../players/wallet.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { sumWalletFlows, type WalletFlows } from './analytics.helpers.js';
import type { AnalyticsWindow } from './window.js';

export type EconomySummary = WalletFlows;

// Screen B data (GDD §17): credits entering vs leaving (inflation) and the sinks
// breakdown — the acceptance question is whether wear (repair + refuel) is the main
// drain. Wallet movements live in PlayerEvent with a signed creditsDelta, windowed on
// (type, at) (migration 0021).
@Injectable()
export class EconomyService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(window: AnalyticsWindow): Promise<EconomySummary> {
    const events = await this.prisma.playerEvent.findMany({
      where: {
        at: { gte: window.from, lte: window.to },
        type: { in: [WALLET_CREDIT_EVENT, WALLET_DEBIT_EVENT] },
      },
      select: { creditsDelta: true, payload: true },
    });
    return sumWalletFlows(
      events.map((event) => ({ creditsDelta: event.creditsDelta, payload: event.payload })),
    );
  }
}
