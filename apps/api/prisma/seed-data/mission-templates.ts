import type { MissionType, Prisma, PrismaClient } from '@prisma/client';

export const TEMPLATES: {
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
    id: 'race_luna',
    displayName: { en: 'Luna Grand Prix', 'pt-BR': 'Grande Prêmio da Luna' },
    description: {
      en: 'Race a field of rival ships to a Luna-controlled port. Fast ships only; the prize follows your finishing place.',
      'pt-BR':
        'Dispute uma corrida contra naves rivais até um porto controlado pela Luna. Só naves rápidas; o prêmio segue a sua colocação.',
    },
    type: 'RACE',
    factionId: 'luna',
    requirements: { originFactions: ['luna'], originTypes: ['port', 'shipyard'] },
  },
  {
    id: 'race_sun',
    displayName: { en: 'Sun Sprint', 'pt-BR': 'Corrida Solar' },
    description: {
      en: 'A sprint across Sun space against rival pilots. Place in the top three to get paid.',
      'pt-BR':
        'Uma corrida pelo espaço do Sol contra pilotos rivais. Chegue entre os três primeiros para receber.',
    },
    type: 'RACE',
    factionId: 'sun',
    requirements: { originFactions: ['sun'], originTypes: ['port', 'garrison'] },
  },
  {
    id: 'race_explorers',
    displayName: { en: 'Deep Run', 'pt-BR': 'Corrida do Abismo' },
    description: {
      en: 'A long, dangerous run through the deep against the Explorers best racers.',
      'pt-BR':
        'Uma corrida longa e perigosa pelo abismo contra os melhores pilotos dos Exploradores.',
    },
    type: 'RACE',
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
    id: 'delivery_luna_medical',
    displayName: { en: 'Medical Supplies', 'pt-BR': 'Suprimentos Médicos' },
    description: {
      en: 'Rush sealed medical crates to a clinic. Light cargo, but the clock is short.',
      'pt-BR': 'Leve caixas médicas lacradas a uma clínica. Carga leve, mas o prazo é curto.',
    },
    type: 'DELIVERY',
    factionId: 'luna',
    requirements: { originFactions: ['luna'], originTypes: ['port', 'shipyard'], cargo: 1 },
  },
  {
    id: 'delivery_luna_freight',
    displayName: { en: 'Bulk Freight', 'pt-BR': 'Frete a Granel' },
    description: {
      en: 'Haul a heavy container shipment for a corporate buyer. A fixed load that fills a lot of cargo space, and pays for it.',
      'pt-BR':
        'Transporte um grande lote de contêineres para um comprador corporativo. Uma carga fixa que ocupa muito espaço de carga, e paga por isso.',
    },
    type: 'DELIVERY',
    factionId: 'luna',
    requirements: { originFactions: ['luna'], cargo: 10, cargoMode: 'fixed' },
  },
  {
    id: 'delivery_luna_parcel',
    displayName: { en: 'Express Parcel', 'pt-BR': 'Encomenda Expressa' },
    description: {
      en: 'A small sealed parcel that must arrive intact. Any ship with a cargo hold can take it.',
      'pt-BR':
        'Uma pequena encomenda lacrada que precisa chegar intacta. Qualquer nave com um compartimento de carga serve.',
    },
    type: 'DELIVERY',
    factionId: 'luna',
    requirements: { originFactions: ['luna'], cargo: 1 },
  },
  {
    id: 'delivery_sun_rations',
    displayName: { en: 'Field Rations', 'pt-BR': 'Rações de Campo' },
    description: {
      en: 'Carry rations and water to a garrison running low. Steady, honest work: take as much as your hold carries and the extra is paid by the unit.',
      'pt-BR':
        'Leve rações e água a uma guarnição com pouco estoque. Trabalho firme e honesto: leve o quanto o porão aguentar e o excedente é pago por unidade.',
    },
    type: 'DELIVERY',
    factionId: 'sun',
    requirements: {
      originFactions: ['sun'],
      originTypes: ['garrison', 'port', 'junction'],
      cargo: 3,
      cargoMode: 'open',
    },
  },
  {
    id: 'delivery_sun_ammo',
    displayName: { en: 'Ammunition Run', 'pt-BR': 'Carregamento de Munição' },
    description: {
      en: 'Move a fixed load of ammunition crates between Alliance posts. Heavy and a target for raiders.',
      'pt-BR':
        'Leve uma carga fixa de caixas de munição entre postos da Aliança. Pesado e alvo de saqueadores.',
    },
    type: 'DELIVERY',
    factionId: 'sun',
    requirements: { originFactions: ['sun'], cargo: 6, cargoMode: 'fixed' },
  },
  {
    id: 'delivery_explorers_parts',
    displayName: { en: 'Spare Parts', 'pt-BR': 'Peças de Reposição' },
    description: {
      en: 'Bring spare parts to an outpost far from any shipyard. They will thank you, and pay for every extra unit you can carry.',
      'pt-BR':
        'Leve peças de reposição a um posto longe de qualquer estaleiro. Eles vão agradecer e pagar por cada unidade extra que você levar.',
    },
    type: 'DELIVERY',
    factionId: 'explorers',
    requirements: {
      originFactions: ['explorers'],
      originTypes: ['outpost', 'frontier'],
      cargo: 2,
      cargoMode: 'open',
    },
  },
  {
    id: 'delivery_explorers_beacon',
    displayName: { en: 'Beacon Kit', 'pt-BR': 'Kit de Baliza' },
    description: {
      en: 'Deliver a beacon kit to mark a new route through the belt.',
      'pt-BR': 'Entregue um kit de baliza para marcar uma nova rota pelo cinturão.',
    },
    type: 'DELIVERY',
    factionId: 'explorers',
    requirements: { originFactions: ['explorers'], cargo: 1 },
  },
  {
    id: 'transport_luna_executives',
    displayName: { en: 'Executive Shuttle', 'pt-BR': 'Traslado Executivo' },
    description: {
      en: 'Fly executives to a meeting. They expect a smooth, quiet ride.',
      'pt-BR': 'Leve executivos a uma reunião. Eles esperam um voo suave e silencioso.',
    },
    type: 'TRANSPORT',
    factionId: 'luna',
    requirements: { originFactions: ['luna'], originTypes: ['port', 'shipyard'] },
  },
  {
    id: 'transport_sun_rotation',
    displayName: { en: 'Crew Rotation', 'pt-BR': 'Rotação de Tripulação' },
    description: {
      en: 'Swap a garrison crew for the next shift.',
      'pt-BR': 'Troque a tripulação de uma guarnição pelo próximo turno.',
    },
    type: 'TRANSPORT',
    factionId: 'sun',
    requirements: { originFactions: ['sun'], originTypes: ['garrison', 'port'] },
  },
  {
    id: 'transport_explorers_survey',
    displayName: { en: 'Survey Team', 'pt-BR': 'Equipe de Prospecção' },
    description: {
      en: 'Carry a survey team to an unmapped stretch of the belt.',
      'pt-BR': 'Leve uma equipe de prospecção a um trecho não mapeado do cinturão.',
    },
    type: 'TRANSPORT',
    factionId: 'explorers',
    requirements: { originFactions: ['explorers'] },
  },
  {
    id: 'escort_luna_convoy',
    displayName: { en: 'Corporate Convoy', 'pt-BR': 'Comboio Corporativo' },
    description: {
      en: 'Shadow a corporate freighter through contested lanes and keep it alive.',
      'pt-BR': 'Acompanhe um cargueiro corporativo por rotas disputadas e mantenha-o vivo.',
    },
    type: 'ESCORT',
    factionId: 'luna',
    requirements: { originFactions: ['luna'], originTypes: ['port', 'shipyard'] },
  },
  {
    id: 'escort_explorers_survey',
    displayName: { en: 'Survey Ship Escort', 'pt-BR': 'Escolta de Nave de Prospecção' },
    description: {
      en: 'Guard a slow survey ship on its way out of the safe zone.',
      'pt-BR': 'Proteja uma nave de prospecção lenta saindo da zona segura.',
    },
    type: 'ESCORT',
    factionId: 'explorers',
    requirements: { originFactions: ['explorers'] },
  },
  {
    id: 'mining_sun_quarry',
    displayName: { en: 'Alliance Quarry', 'pt-BR': 'Pedreira da Aliança' },
    description: {
      en: 'Work an Alliance-licensed rock for ore. Bring a mining rig and room to carry it.',
      'pt-BR':
        'Trabalhe uma rocha licenciada pela Aliança atrás de minério. Leve uma mineradora e espaço para carregá-lo.',
    },
    type: 'MINING',
    factionId: 'sun',
    requirements: {
      originFactions: ['sun'],
      originTypes: ['garrison', 'port', 'junction'],
      cargo: 2,
    },
  },
  {
    id: 'mining_luna_extraction',
    displayName: { en: 'Extraction Contract', 'pt-BR': 'Contrato de Extração' },
    description: {
      en: 'A corporate extraction contract on a remote rock. Steady pay, long trip.',
      'pt-BR':
        'Um contrato corporativo de extração numa rocha remota. Pagamento firme, viagem longa.',
    },
    type: 'MINING',
    factionId: 'luna',
    requirements: { originFactions: ['luna'], cargo: 2 },
  },
  {
    id: 'rescue_explorers_beacon',
    displayName: { en: 'Distress Beacon', 'pt-BR': 'Sinal de Socorro' },
    description: {
      en: 'A beacon went off out in the belt. Get there before the air runs out.',
      'pt-BR': 'Uma baliza disparou no cinturão. Chegue antes que o ar acabe.',
    },
    type: 'RESCUE',
    factionId: 'explorers',
    requirements: { originFactions: ['explorers'], originTypes: ['outpost', 'frontier', 'relay'] },
  },
  {
    id: 'rescue_sun_patrol',
    displayName: { en: 'Patrol Recovery', 'pt-BR': 'Resgate de Patrulha' },
    description: {
      en: 'A patrol craft is adrift and its crew needs a tow home.',
      'pt-BR': 'Uma nave de patrulha está à deriva e a tripulação precisa de reboque.',
    },
    type: 'RESCUE',
    factionId: 'sun',
    requirements: { originFactions: ['sun'], originTypes: ['garrison', 'junction'] },
  },
  {
    // Scavenging jobs (POST /v1/locations/:id/scavenge): inactive, created by the job service.
    id: 'scavenge_generic',
    displayName: { en: 'Scavenging', 'pt-BR': 'Saque de destroços' },
    description: {
      en: 'A search of the wreckage around the port: no pay, only what you find.',
      'pt-BR': 'Uma busca nos destroços ao redor do porto: sem pagamento, só o que você achar.',
    },
    type: 'SCAVENGE',
    factionId: 'luna',
    requirements: {},
    active: false,
  },
  {
    // Independent mining jobs (POST /v1/locations/:id/mine, round 10): inactive, created by
    // MiningJobService — the board generator must never offer it.
    id: 'mining_job_generic',
    displayName: { en: 'Independent mining', 'pt-BR': 'Mineração independente' },
    description: {
      en: 'A dig at a minable location: no pay, only what the hold brings back.',
      'pt-BR': 'Uma escavação num local minerável: sem pagamento, só o que o porão trouxer.',
    },
    type: 'MINING',
    factionId: 'luna',
    requirements: {},
    active: false,
  },
  {
    // Pilot-requested trips (POST /v1/travel). Inactive on purpose: the board generator must
    // never offer it; the travel service creates instances from it directly.
    id: 'travel_generic',
    displayName: { en: 'Travel', 'pt-BR': 'Viagem' },
    description: {
      en: 'A trip you asked for: no cargo and no pay, only the fuel it burns.',
      'pt-BR':
        'Uma viagem que você pediu: sem carga e sem pagamento, só o combustível que ela gasta.',
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
          // GDD §8: deliveries and transports try to flee an attacker instead of fighting it.
          encounterPolicy:
            template.type === 'DELIVERY' || template.type === 'TRANSPORT'
              ? { missionForcesFlee: true }
              : {},
          active: template.active ?? true,
        },
      });
    }
  }
}
