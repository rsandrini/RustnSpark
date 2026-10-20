import type { Prisma, PrismaClient } from '@prisma/client';

// More variety on the boards (2026-10-20): the big ports now post 8 offers, and escorts, rescues and races each had
// one template per faction, so the same jobs came round again and again. A few more of each, with their own words.
// Like every seed this only FILLS what is missing: whatever an admin edited stays.

type Text = { en: string; 'pt-BR': string };

interface Template {
  id: string;
  displayName: Text;
  description: Text;
  type: 'ESCORT' | 'RESCUE' | 'RACE';
  factionId: string;
  requirements: Record<string, unknown>;
}

const TEMPLATES: Template[] = [
  {
    id: 'escort_luna_freight',
    displayName: { en: 'Freight Guard', 'pt-BR': 'Guarda de Carga' },
    description: {
      en: 'A heavy hauler wants a gun alongside for the run through the lanes. Keep close and keep the cargo safe.',
      'pt-BR':
        'Um cargueiro pesado quer uma arma ao lado na travessia das rotas. Fique perto e mantenha a carga a salvo.',
    },
    type: 'ESCORT',
    factionId: 'luna',
    requirements: { originTypes: ['port', 'shipyard', 'outpost'], originFactions: ['luna'] },
  },
  {
    id: 'escort_sun_picket',
    displayName: { en: 'Convoy Picket', 'pt-BR': 'Piquete de Comboio' },
    description: {
      en: 'The garrison sends a supply convoy and needs an escort on its flank. Pirates have been seen.',
      'pt-BR':
        'A guarnição envia um comboio de suprimentos e precisa de uma escolta no flanco. Piratas foram vistos.',
    },
    type: 'ESCORT',
    factionId: 'sun',
    requirements: { originTypes: ['garrison', 'port', 'junction'], originFactions: ['sun'] },
  },
  {
    id: 'escort_explorers_caravan',
    displayName: { en: 'Caravan Watch', 'pt-BR': 'Vigia de Caravana' },
    description: {
      en: 'A prospector caravan crosses the empty stretch and wants someone armed to ride with it.',
      'pt-BR':
        'Uma caravana de prospectores cruza o trecho vazio e quer alguém armado para acompanhá-la.',
    },
    type: 'ESCORT',
    factionId: 'explorers',
    requirements: { originTypes: ['outpost', 'frontier', 'relay'], originFactions: ['explorers'] },
  },
  {
    id: 'rescue_luna_tow',
    displayName: { en: 'Tow Job', 'pt-BR': 'Serviço de Reboque' },
    description: {
      en: 'A drive-dead hauler is drifting off the lane. Reach it, take the crew aboard and bring them in.',
      'pt-BR':
        'Um cargueiro sem propulsão vai à deriva fora da rota. Alcance-o, embarque a tripulação e traga-a de volta.',
    },
    type: 'RESCUE',
    factionId: 'luna',
    requirements: { originTypes: ['port', 'shipyard', 'outpost'], originFactions: ['luna'] },
  },
  {
    id: 'rescue_explorers_lost',
    displayName: { en: 'Lost Prospector', 'pt-BR': 'Prospector Perdido' },
    description: {
      en: 'A lone prospector has stopped answering the radio past the last beacon. Find them before the air runs out.',
      'pt-BR':
        'Um prospector solitário parou de responder ao rádio depois do último farol. Encontre-o antes que o ar acabe.',
    },
    type: 'RESCUE',
    factionId: 'explorers',
    requirements: { originTypes: ['outpost', 'frontier'], originFactions: ['explorers'] },
  },
  {
    id: 'race_luna_dash',
    displayName: { en: 'Dockside Dash', 'pt-BR': 'Corrida do Cais' },
    description: {
      en: 'A quick race between the yards: the first one back to the dock wins the purse.',
      'pt-BR': 'Uma corrida rápida entre os estaleiros: o primeiro a voltar ao cais leva o prêmio.',
    },
    type: 'RACE',
    factionId: 'luna',
    requirements: { originTypes: ['port', 'shipyard'], originFactions: ['luna'] },
  },
  {
    id: 'race_sun_gauntlet',
    displayName: { en: 'Garrison Gauntlet', 'pt-BR': 'Desafio da Guarnição' },
    description: {
      en: 'The garrison pilots run a gauntlet course every cycle. Beat them and the pot is yours.',
      'pt-BR':
        'Os pilotos da guarnição correm um percurso de obstáculos a cada ciclo. Vença-os e o prêmio é seu.',
    },
    type: 'RACE',
    factionId: 'sun',
    requirements: { originTypes: ['port', 'garrison', 'junction'], originFactions: ['sun'] },
  },
  {
    id: 'race_explorers_dash',
    displayName: { en: 'Frontier Dash', 'pt-BR': 'Corrida da Fronteira' },
    description: {
      en: 'Frontier pilots bet on a dash across the claims. Fast ships only.',
      'pt-BR': 'Pilotos da fronteira apostam numa corrida pelas concessões. Só naves rápidas.',
    },
    type: 'RACE',
    factionId: 'explorers',
    requirements: { originTypes: ['outpost', 'frontier', 'relay'], originFactions: ['explorers'] },
  },
];

export async function seedBoardVariety(prisma: PrismaClient): Promise<void> {
  for (const template of TEMPLATES) {
    if ((await prisma.missionTemplate.findUnique({ where: { id: template.id } })) !== null)
      continue;
    await prisma.missionTemplate.create({
      data: {
        ...template,
        requirements: template.requirements as Prisma.InputJsonValue,
        rewardCalc: {},
        deadlineCalc: {},
        encounterPolicy: {},
        active: true,
      },
    });
  }
}
