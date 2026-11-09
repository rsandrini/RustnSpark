import { PrismaService } from '../prisma/prisma.service.js';
import type { GameRules } from '../config/game-config.types.js';
import { placeKeyOf, type MineableOre } from '../resolution/mining/mining-yield.js';
import { miningMaterialsFor } from './generator/template.filler.js';

/**
 * The ores a dig at `locationId` can find (a far field may hold only some) and the place's row of `mining.place_mix`, read when the run is
 * dispatched or resolved and stored with it, so a replay digs from the same ores whatever the
 * materials or templates say later. Sorted by id: the ore roll walks them in that order.
 */
export async function loadMiningOres(
  prisma: Pick<PrismaService, 'location' | 'missionTemplate' | 'material'>,
  locationId: string,
  rules: GameRules,
): Promise<{ ores: MineableOre[]; placeKey: string }> {
  const [location, templates, materials] = await Promise.all([
    prisma.location.findUniqueOrThrow({
      where: { id: locationId },
      select: { id: true, type: true, zone: true, factionId: true },
    }),
    prisma.missionTemplate.findMany({ where: { type: 'MINING', active: true } }),
    prisma.material.findMany({
      where: { active: true, fixedPrice: false },
      orderBy: { id: 'asc' },
    }),
  ]);
  return {
    ores: miningMaterialsFor(location, templates, materials).map((material) => ({
      id: material.id,
      rarity: material.rarity.toLowerCase(),
      price: material.basePrice,
    })),
    placeKey: placeKeyOf(location, rules),
  };
}
