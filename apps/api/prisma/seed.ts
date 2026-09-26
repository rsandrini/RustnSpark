import { PrismaClient } from '@prisma/client';
import { seedDropTables } from './seed-data/drop-tables.js';
import { seedEnvironments } from './seed-data/environments.js';
import { seedFactions } from './seed-data/factions.js';
import { seedGameConfig } from './seed-data/game-config.js';
import { seedMaterials, seedScrapMaterials } from './seed-data/materials.js';
import { seedMissionTemplates } from './seed-data/mission-templates.js';
import { seedParts } from './seed-data/parts.js';
import { seedWorld } from './seed-data/world-builder.js';

export async function seed(prisma?: PrismaClient): Promise<void> {
  const client = prisma ?? new PrismaClient();
  const ownsClient = prisma === undefined;

  try {
    await seedFactions(client);
    await seedEnvironments(client);
    await seedWorld(client);
    await seedParts(client);
    await seedMaterials(client);
    await seedScrapMaterials(client);
    await seedMissionTemplates(client);
    await seedDropTables(client);
    await seedGameConfig(client);
  } finally {
    if (ownsClient) {
      await client.$disconnect();
    }
  }
}

// Only execute when this file is the process entry point; tests import seed() directly.
const isEntryPoint =
  import.meta.url.startsWith('file:') && process.argv[1]?.includes('seed.ts') === true;
if (isEntryPoint) {
  seed().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
