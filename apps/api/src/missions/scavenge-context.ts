import type { PrismaService } from '../prisma/prisma.service.js';
import { fieldTypeOf } from '../economy/scavenging.service.js';
import type { ScavengeContext } from '../resolution/scavenge/scavenge.resolver.js';

// Places where wreckage is scrap: some finds there are scrap (a fixed-price material) rather than parts.
const SCRAP_PLACE_TYPES: ReadonlySet<string> = new Set(['scrap_field', 'dead_zone', 'relay']);

/**
 * What a scavenging job at `locationId` can turn up, read once when the job resolves and then stored
 * with the run (D19) so the admin replay finds exactly the same things.
 */
export async function loadScavengeContext(
  prisma: PrismaService,
  locationId: string,
): Promise<ScavengeContext> {
  const [location, table, catalog] = await Promise.all([
    prisma.location.findUniqueOrThrow({
      where: { id: locationId },
      select: { zone: true, type: true, factionId: true },
    }),
    prisma.dropTable.findFirst({ where: { source: 'scavenging' }, orderBy: { id: 'asc' } }),
    prisma.partCatalog.findMany({
      // A bridge is never something you turn up in the wreckage (every ship has its own).
      where: { active: true, partClass: { not: 'BRIDGE' } },
      orderBy: { partType: 'asc' },
      select: { partType: true, rarity: true },
    }),
  ]);
  const tiers = Array.isArray(table?.tiers)
    ? (table.tiers as unknown[]).flatMap((entry) => {
        const candidate = entry as { tier?: unknown; chance?: unknown };
        return typeof candidate.tier === 'string' && typeof candidate.chance === 'number'
          ? [{ tier: candidate.tier, chance: candidate.chance }]
          : [];
      })
    : [];
  return {
    zone: location.zone,
    fieldType: fieldTypeOf(location),
    scrapPlace: SCRAP_PLACE_TYPES.has(location.type),
    tiers,
    catalog,
  };
}
