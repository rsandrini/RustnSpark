import type { PrismaClient } from '@prisma/client';

const DROP_TABLES = [
  {
    id: 'scavenging_common',
    source: 'scavenging',
    tiers: [
      { tier: 'COMMON', chance: 0.6 },
      { tier: 'UNCOMMON', chance: 0.3 },
      { tier: 'RARE', chance: 0.1 },
    ],
  },
  {
    id: 'npc_common',
    source: 'npc_common',
    tiers: [
      { tier: 'COMMON', chance: 0.5 },
      { tier: 'UNCOMMON', chance: 0.4 },
      { tier: 'RARE', chance: 0.1 },
    ],
  },
  {
    id: 'npc_elite',
    source: 'npc_elite',
    tiers: [
      { tier: 'UNCOMMON', chance: 0.4 },
      { tier: 'RARE', chance: 0.4 },
      { tier: 'EPIC', chance: 0.2 },
    ],
  },
];

export async function seedDropTables(prisma: PrismaClient): Promise<void> {
  for (const table of DROP_TABLES) {
    const existing = await prisma.dropTable.findUnique({ where: { id: table.id } });
    if (existing === null) {
      await prisma.dropTable.create({ data: table });
    }
  }
}
