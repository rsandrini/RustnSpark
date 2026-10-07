import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import { rollConnectors, type ConnectorLayout } from './connectors.js';

/** For the 3 creation call sites that only have a bare partType string in scope (onboarding's
    starter kit, a restart kit, a scavenge find) — fetches just enough of the catalog row to
    roll. market.service.ts already has the full catalog row loaded and calls rollConnectors
    directly (with a listing-derived seed) instead of this wrapper. */
export async function rollConnectorsForPartType(
  tx: Prisma.TransactionClient | PrismaService,
  partType: string,
): Promise<ConnectorLayout | null> {
  const row = await tx.partCatalog.findUniqueOrThrow({
    where: { partType },
    select: { connectorRules: true, w: true, h: true },
  });
  return rollConnectors(row);
}
