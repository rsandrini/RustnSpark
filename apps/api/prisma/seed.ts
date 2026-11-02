import { PrismaClient } from '@prisma/client';
import { callsignOf } from '../src/stats/callsign.js';
import { seedDropTables } from './seed-data/drop-tables.js';
import { seedEnvironments } from './seed-data/environments.js';
import { seedFactions } from './seed-data/factions.js';
import { seedFarZones } from './seed-data/far-zones.js';
import { seedGameConfig } from './seed-data/game-config.js';
import { seedBoardVariety } from './seed-data/board-variety.js';
import { seedMapExtension } from './seed-data/map-extension.js';
import { seedMaterials, seedScrapMaterials } from './seed-data/materials.js';
import { seedMissionTemplates } from './seed-data/mission-templates.js';
import { seedDialogueScenes } from './seed-data/dialogue-scenes.js';
import { seedParts } from './seed-data/parts.js';
import { seedReportTemplates } from './seed-data/report-templates.js';
import { seedQuestGivers } from './seed-data/quest-givers.js';
import { seedShipFormats } from './seed-data/ship-formats.js';
import { seedWorld } from './seed-data/world-builder.js';

export async function seed(prisma?: PrismaClient): Promise<void> {
  const client = prisma ?? new PrismaClient();
  const ownsClient = prisma === undefined;

  try {
    await seedFactions(client);
    await seedEnvironments(client);
    await seedWorld(client);
    await seedShipFormats(client);
    await seedParts(client);
    await seedMaterials(client);
    await seedScrapMaterials(client);
    await seedMissionTemplates(client);
    // After the templates and the scrap: the far zones add a place, its routes and a mining offer.
    await seedFarZones(client);
    await seedMapExtension(client);
    await seedBoardVariety(client);
    await seedQuestGivers(client);
    await seedDialogueScenes(client);
    await seedReportTemplates(client);
    await seedDropTables(client);
    await seedGameConfig(client);
    await renameGenericStarterShips(client);
  } finally {
    if (ownsClient) {
      await client.$disconnect();
    }
  }
}

/**
 * Ships made before they got a callsign are called "<faction> starter" (the same for everyone): give them the
 * callsign their pilot's public card shows. Only those exact generic names are touched, so it is safe on every run.
 */
async function renameGenericStarterShips(client: PrismaClient): Promise<void> {
  const ships = await client.ship.findMany({
    where: { name: { endsWith: ' starter' } },
    select: { id: true, name: true, owner: { select: { id: true, name: true, factionId: true } } },
  });
  for (const ship of ships) {
    if (ship.owner.factionId === null || ship.name !== `${ship.owner.factionId} starter`) continue;
    await client.ship.update({
      where: { id: ship.id },
      data: {
        name: callsignOf({
          factionId: ship.owner.factionId,
          playerName: ship.owner.name,
          playerId: ship.owner.id,
        }),
      },
    });
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
