import type { PrismaClient } from '@prisma/client';
import { CONFIG_REGISTRY } from '../../src/config/config-registry.js';

export async function seedGameConfig(prisma: PrismaClient): Promise<void> {
  for (const entry of CONFIG_REGISTRY) {
    const existing = await prisma.gameConfig.findUnique({ where: { key: entry.key } });
    if (existing === null) {
      await prisma.gameConfig.create({
        data: {
          key: entry.key,
          value: entry.factoryDefault as never,
          type: entry.type,
          description: entry.description,
          updatedBy: 'seed',
        },
      });
    }
  }
}
