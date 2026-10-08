import type { PrismaClient } from '@prisma/client';

const FACTIONS = [
  {
    id: 'luna',
    displayName: { en: 'Luna Authority', 'pt-BR': 'Autoridade de Luna' },
    description: {
      en: 'Port clerks, steady freight and the weight of official seals behind every contract.',
      'pt-BR':
        'Escritórios portuários, frete previsível e o peso dos selos oficiais em cada contrato.',
    },
    color: '#4a90d9',
    playable: true,
    relations: { luna: 'neutral', sun: 'neutral', explorers: 'neutral', pirates: 'hostile' },
  },
  {
    id: 'sun',
    displayName: { en: 'Sun Traders', 'pt-BR': 'Comerciantes do Sol' },
    description: {
      en: 'Free merchants who answer to no port authority and always know a buyer.',
      'pt-BR':
        'Livre-comerciantes que não respondem a autoridade portuária e sempre conhecem um comprador.',
    },
    color: '#e3b341',
    playable: true,
    relations: { luna: 'neutral', sun: 'neutral', explorers: 'neutral', pirates: 'hostile' },
  },
  {
    id: 'explorers',
    displayName: { en: 'Explorers', 'pt-BR': 'Exploradores' },
    description: {
      en: 'Frontier prospectors pushing past the charted belt for ore nobody has priced yet.',
      'pt-BR':
        'Prospectores de fronteira empurrando além da cinta catalogada por minério que ninguém precificou.',
    },
    color: '#3fa66a',
    playable: true,
    relations: { luna: 'neutral', sun: 'neutral', explorers: 'neutral', pirates: 'hostile' },
  },
  {
    id: 'pirates',
    displayName: { en: 'Pirates', 'pt-BR': 'Piratas' },
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
