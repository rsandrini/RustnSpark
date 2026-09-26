import type { MissionType, Prisma, PrismaClient } from '@prisma/client';

const TEMPLATES: {
  id: string;
  displayName: { en: string; 'pt-BR': string };
  description: { en: string; 'pt-BR': string };
  type: MissionType;
  factionId: string;
  requirements: Record<string, unknown>;
  active?: boolean;
}[] = [
  {
    id: 'delivery_luna',
    displayName: { en: 'Luna Delivery', 'pt-BR': 'Entrega da Luna' },
    description: {
      en: 'Deliver corporate cargo to a Luna-controlled port.',
      'pt-BR': 'Entregue carga corporativa em um porto controlado pela Luna.',
    },
    type: 'DELIVERY',
    factionId: 'luna',
    requirements: { originFactions: ['luna'], originTypes: ['port', 'shipyard'] },
  },
  {
    id: 'delivery_sun',
    displayName: { en: 'Sun Delivery', 'pt-BR': 'Entrega Solar' },
    description: {
      en: 'Ship Alliance supplies to a Sun-controlled port.',
      'pt-BR': 'Transporte suprimentos da Aliança para um porto controlado pelo Sol.',
    },
    type: 'DELIVERY',
    factionId: 'sun',
    requirements: { originFactions: ['sun'], originTypes: ['port', 'garrison'] },
  },
  {
    id: 'delivery_explorers',
    displayName: { en: 'Explorers Delivery', 'pt-BR': 'Entrega dos Exploradores' },
    description: {
      en: 'Run supplies to a Deep Explorers outpost.',
      'pt-BR': 'Leve suprimentos a um posto dos Exploradores do Abismo.',
    },
    type: 'DELIVERY',
    factionId: 'explorers',
    requirements: { originFactions: ['explorers'], originTypes: ['outpost', 'frontier'] },
  },
  {
    id: 'transport_luna',
    displayName: { en: 'Luna Transport', 'pt-BR': 'Transporte da Luna' },
    description: {
      en: 'Transport personnel between Luna hubs.',
      'pt-BR': 'Transporte pessoal entre hubs da Luna.',
    },
    type: 'TRANSPORT',
    factionId: 'luna',
    requirements: { originFactions: ['luna'] },
  },
  {
    id: 'transport_sun',
    displayName: { en: 'Sun Transport', 'pt-BR': 'Transporte Solar' },
    description: {
      en: 'Move Alliance crew across solar outposts.',
      'pt-BR': 'Mova tripulação da Aliança entre postos solares.',
    },
    type: 'TRANSPORT',
    factionId: 'sun',
    requirements: { originFactions: ['sun'] },
  },
  {
    id: 'escort_sun',
    displayName: { en: 'Sun Escort', 'pt-BR': 'Escolta Solar' },
    description: {
      en: 'Escort an Alliance convoy through contested space.',
      'pt-BR': 'Escolte um comboio da Aliança pelo espaço contestado.',
    },
    type: 'ESCORT',
    factionId: 'sun',
    requirements: { originFactions: ['sun'], originTypes: ['garrison', 'port'] },
  },
  {
    id: 'mining_explorers',
    displayName: { en: 'Explorers Mining', 'pt-BR': 'Mineração dos Exploradores' },
    description: {
      en: 'Extract minerals from a debris field or mining site.',
      'pt-BR': 'Extraia minerais de um campo de detritos ou local de mineração.',
    },
    type: 'MINING',
    factionId: 'explorers',
    requirements: {
      originFactions: ['explorers'],
      originTypes: ['scrap_field', 'outpost', 'frontier'],
    },
  },
  {
    id: 'mining_pirates',
    displayName: { en: 'Claim Salvage', 'pt-BR': 'Reivindicar Sucata' },
    description: {
      en: 'Strip valuable salvage from a debris field.',
      'pt-BR': 'Recolha sucata valiosa de um campo de detritos.',
    },
    type: 'MINING',
    factionId: 'pirates',
    requirements: { originFactions: ['pirates'], originTypes: ['scrap_field', 'dead_zone'] },
  },
  {
    id: 'rescue_explorers',
    displayName: { en: 'Explorers Rescue', 'pt-BR': 'Resgate dos Exploradores' },
    description: {
      en: 'Rescue a stranded crew from a remote location.',
      'pt-BR': 'Resgate uma tripulação isolada em um local remoto.',
    },
    type: 'RESCUE',
    factionId: 'explorers',
    requirements: {
      originFactions: ['explorers'],
      originTypes: ['outpost', 'relay', 'dead_zone', 'scrap_field'],
    },
  },
  {
    id: 'rescue_sun',
    displayName: { en: 'Sun Rescue', 'pt-BR': 'Resgate Solar' },
    description: {
      en: 'Extract Alliance personnel from a dangerous sector.',
      'pt-BR': 'Extraia pessoal da Aliança de um setor perigoso.',
    },
    type: 'RESCUE',
    factionId: 'sun',
    requirements: { originFactions: ['sun'], originTypes: ['garrison', 'port', 'junction'] },
  },
  {
    id: 'rescue_luna',
    displayName: { en: 'Luna Rescue', 'pt-BR': 'Resgate da Luna' },
    description: {
      en: 'Recover corporate assets from a disabled vessel.',
      'pt-BR': 'Recupere ativos corporativos de uma nave desativada.',
    },
    type: 'RESCUE',
    factionId: 'luna',
    requirements: { originFactions: ['luna'], originTypes: ['port', 'shipyard'] },
  },
  {
    // Pilot-requested trips (POST /v1/travel). Inactive on purpose: the board generator must
    // never offer it; the travel service creates instances from it directly.
    id: 'travel_generic',
    displayName: { en: 'Travel', 'pt-BR': 'Viagem' },
    description: {
      en: 'A trip you asked for: no cargo and no pay, only the fuel it burns.',
      'pt-BR': 'Uma viagem que você pediu: sem carga e sem pagamento, só o combustível que ela gasta.',
    },
    type: 'TRAVEL',
    factionId: 'luna',
    requirements: {},
    active: false,
  },
];

export async function seedMissionTemplates(prisma: PrismaClient): Promise<void> {
  for (const template of TEMPLATES) {
    const existing = await prisma.missionTemplate.findUnique({ where: { id: template.id } });
    if (existing === null) {
      await prisma.missionTemplate.create({
        data: {
          ...template,
          requirements: template.requirements as Prisma.InputJsonValue,
          rewardCalc: {},
          deadlineCalc: {},
          encounterPolicy: {},
          active: template.active ?? true,
        },
      });
    }
  }
}
