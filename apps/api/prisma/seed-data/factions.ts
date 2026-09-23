import type { PrismaClient } from '@prisma/client';

const FACTIONS = [
  {
    id: 'luna',
    displayName: { en: 'Luna Corporation', 'pt-BR': 'Luna Corp' },
    description: {
      en: 'A disciplined corporate consortium that controls the central trade hubs.',
      'pt-BR': 'Um consórcio corporativo disciplinado que controla os hubs comerciais centrais.',
    },
    color: '#4a90d9',
    playable: true,
    relations: { luna: 'neutral', sun: 'neutral', explorers: 'neutral', pirates: 'hostile' },
  },
  {
    id: 'sun',
    displayName: { en: 'Sun Alliance', 'pt-BR': 'Aliança Solar' },
    description: {
      en: 'A militarized alliance guarding the solar approaches and garrison outposts.',
      'pt-BR': 'Uma aliança militarizada que protege as rotas solares e postos de guarnição.',
    },
    color: '#e3b341',
    playable: true,
    relations: { luna: 'neutral', sun: 'neutral', explorers: 'neutral', pirates: 'hostile' },
  },
  {
    id: 'explorers',
    displayName: { en: 'Deep Explorers', 'pt-BR': 'Exploradores do Abismo' },
    description: {
      en: 'Independent pioneers operating on the sector fringe and mining fields.',
      'pt-BR': 'Pioneiros independentes que atuam na fronteira do setor e campos de mineração.',
    },
    color: '#3fa66a',
    playable: true,
    relations: { luna: 'neutral', sun: 'neutral', explorers: 'neutral', pirates: 'hostile' },
  },
  {
    id: 'pirates',
    displayName: { en: 'Pirate Clans', 'pt-BR': 'Clãs Piratas' },
    description: {
      en: 'Loose clans that prey on shipping in debris fields and dead zones.',
      'pt-BR': 'Clãs dispersos que atacam rotas comerciais em campos de detritos e zonas mortas.',
    },
    color: '#c23b3b',
    playable: false,
    relations: { luna: 'hostile', sun: 'hostile', explorers: 'hostile', pirates: 'hostile' },
  },
];

export async function seedFactions(prisma: PrismaClient): Promise<void> {
  for (const faction of FACTIONS) {
    const existing = await prisma.faction.findUnique({ where: { id: faction.id } });
    if (existing === null) {
      await prisma.faction.create({ data: faction });
    }
  }
}
