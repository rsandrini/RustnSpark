import type { Prisma, PrismaClient } from '@prisma/client';

// Phase 5 map extension (owner, 2026-10-17): six very short "local" places next to the main ones, and four
// very far places beyond the deep fields. Like every seed this only FILLS what is missing: whatever an
// admin edited stays. The map shows a place by its `detail`: main (always), regional (zoomed in), local
// (zoomed in close).
//
// The local places are service stops, not markets: repair and refuel only, no market, no upgrades (the
// `services` flags say so, and the market and the upgrade refuse a place that turns them off).
// Next to each of the three starting places there is also a TEST PAD: a tiny place seconds away, used by the
// new pilot's very first mission (there and back in seconds) and by nothing else.
// The far places are a long trip beyond what a starter ship's tank can reach, and they are named by their
// own mission templates only (their types are in the generator's opt-in list), so no ordinary mission ever
// ends there.

const LOCAL_SERVICES = {
  buy: false,
  sell: false,
  repair: true,
  refuel: true,
  upgrade: false,
  missions: true,
  passengers: false,
};
const FAR_STATION_SERVICES = {
  buy: true,
  sell: true,
  repair: true,
  refuel: true,
  upgrade: true,
  missions: true,
  passengers: false,
};
const FAR_FIELD_SERVICES = {
  buy: false,
  sell: false,
  repair: false,
  missions: false,
  passengers: false,
};

type Text = { en: string; 'pt-BR': string };

interface Place {
  id: string;
  name: Text;
  description: Text;
  type: string;
  detail: 'main' | 'regional' | 'local';
  x: number;
  y: number;
  zone: number;
  factionId: string;
  isolation: number;
  services: Record<string, boolean>;
}

const PLACES: Place[] = [
  {
    id: 'ceres_dock',
    name: { en: 'Ceres Drydock', 'pt-BR': 'Doca Seca de Ceres' },
    description: {
      en: 'A cradle of gantries a short hop from Ceres Port: patch the hull, top up the tank, nothing else.',
      'pt-BR':
        'Um berço de pórticos a um salto de Porto Ceres: remende o casco, encha o tanque, mais nada.',
    },
    type: 'drydock',
    detail: 'local',
    x: 300,
    y: 395,
    zone: 0,
    factionId: 'luna',
    isolation: 0.9,
    services: LOCAL_SERVICES,
  },
  {
    id: 'tycho_slip',
    name: { en: 'Tycho Slipway', 'pt-BR': 'Rampa de Tycho' },
    description: {
      en: 'The yard hands at Tycho keep a repair slip on a spur of the yard ring. They fix ships and sell fuel, and do not haggle.',
      'pt-BR':
        'A equipe do estaleiro de Tycho mantém uma rampa de reparo num ramal do anel. Consertam naves e vendem combustível, e não pechincham.',
    },
    type: 'drydock',
    detail: 'local',
    x: 125,
    y: 110,
    zone: 0,
    factionId: 'luna',
    isolation: 0.9,
    services: LOCAL_SERVICES,
  },
  {
    id: 'vesta_heap',
    name: { en: 'Vesta Slag Heap', 'pt-BR': 'Pilha de Escória de Vesta' },
    description: {
      en: 'Tailings from the Vesta refinery, dumped in orbit. Scrap pickers work it; the dock sells fuel and patches hulls.',
      'pt-BR':
        'Rejeitos da refinaria de Vesta, despejados em órbita. Catadores de sucata trabalham nela; a doca vende combustível e remenda cascos.',
    },
    type: 'scrapyard',
    detail: 'local',
    x: 480,
    y: 165,
    zone: 1,
    factionId: 'luna',
    isolation: 1,
    services: LOCAL_SERVICES,
  },
  {
    id: 'gate_depot',
    name: { en: 'Kessler Fuel Depot', 'pt-BR': 'Depósito de Combustível Kessler' },
    description: {
      en: 'A string of tanks off the Kessler Gate lane. Fuel and repairs for whoever is passing through.',
      'pt-BR':
        'Uma fileira de tanques ao lado da rota do Portão Kessler. Combustível e reparos para quem estiver de passagem.',
    },
    type: 'fuel_depot',
    detail: 'local',
    x: 610,
    y: 420,
    zone: 2,
    factionId: 'sun',
    isolation: 1.4,
    services: LOCAL_SERVICES,
  },
  {
    id: 'hedus_claim',
    name: { en: 'Hedus Ore Claim', 'pt-BR': 'Concessão de Minério de Hedus' },
    description: {
      en: 'A licensed claim on a rock beside Hedus Base. Mining rigs work it round the clock; the dock does repairs and fuel.',
      'pt-BR':
        'Uma concessão licenciada numa rocha ao lado da Base Hedus. Mineradoras trabalham nela sem parar; a doca faz reparos e abastece.',
    },
    type: 'mining_claim',
    detail: 'local',
    x: 770,
    y: 205,
    zone: 2,
    factionId: 'sun',
    isolation: 1.4,
    services: LOCAL_SERVICES,
  },
  {
    id: 'marsa_station',
    name: { en: 'Marsa Waystation', 'pt-BR': 'Estação de Passagem de Marsa' },
    description: {
      en: 'A lit waystation off Marsa Anchorage for ships that only need a quick patch and a full tank.',
      'pt-BR':
        'Uma estação de passagem iluminada ao lado do Ancoradouro Marsa para naves que só precisam de um remendo rápido e do tanque cheio.',
    },
    type: 'waystation',
    detail: 'local',
    x: 890,
    y: 110,
    zone: 2,
    factionId: 'sun',
    isolation: 1.4,
    services: LOCAL_SERVICES,
  },
  {
    id: 'thule',
    name: { en: 'Thule Beacon', 'pt-BR': 'Baliza de Thule' },
    description: {
      en: 'The last lit station on the charts: a relay and a fuel dock on a rock past the Maw. Nobody comes here by accident.',
      'pt-BR':
        'A última estação iluminada nas cartas: um relé e uma doca de combustível numa rocha depois da Goela. Ninguém chega aqui por acaso.',
    },
    type: 'far_station',
    detail: 'main',
    x: 1640,
    y: 330,
    zone: 3,
    factionId: 'explorers',
    isolation: 2,
    services: FAR_STATION_SERVICES,
  },
  {
    id: 'nadir',
    name: { en: 'Nadir Gate', 'pt-BR': 'Portão Nadir' },
    description: {
      en: 'A pirate-held gate at the bottom of the chart, past the Obsidian Shoal. What passes through pays for it twice.',
      'pt-BR':
        'Um portão dominado por piratas no fundo da carta, depois do Baixio Obsidiana. Quem passa por ele paga duas vezes.',
    },
    type: 'far_station',
    detail: 'main',
    x: 1560,
    y: 660,
    zone: 3,
    factionId: 'pirates',
    isolation: 2,
    services: FAR_STATION_SERVICES,
  },
  {
    id: 'cinder',
    name: { en: 'Cinder Verge', 'pt-BR': 'Orla de Cinzas' },
    description: {
      en: 'A frontier camp on the edge of the dead zone beyond the Veil. Cold, cheap and a very long way from anywhere.',
      'pt-BR':
        'Um acampamento de fronteira na borda da zona morta depois do Véu. Frio, barato e muito longe de qualquer lugar.',
    },
    type: 'far_station',
    detail: 'main',
    x: 1130,
    y: 800,
    zone: 3,
    factionId: 'explorers',
    isolation: 2,
    services: FAR_STATION_SERVICES,
  },
  {
    id: 'lantern',
    name: { en: 'The Lantern', 'pt-BR': 'A Lanterna' },
    description: {
      en: 'A drifting field of glassy rock that glows faintly, far beyond every beacon. The crystal here is the purest anywhere, and so is the silence.',
      'pt-BR':
        'Um campo à deriva de rocha vítrea que brilha fraco, muito além de qualquer baliza. O cristal aqui é o mais puro que existe, e o silêncio também.',
    },
    type: 'far_field',
    detail: 'regional',
    x: 1900,
    y: 500,
    zone: 3,
    factionId: 'explorers',
    isolation: 2,
    services: FAR_FIELD_SERVICES,
  },
  ...[
    {
      home: 'ceres',
      faction: 'luna',
      at: { x: 262, y: 351 },
      zone: 0,
      name: { en: 'Ceres Test Pad', 'pt-BR': 'Plataforma de Testes de Ceres' },
      description: {
        en: 'A launch pad a hop from Ceres Port where new pilots shake a ship down: seconds out, seconds back.',
        'pt-BR':
          'Uma plataforma de lançamento a um salto de Porto Ceres, onde pilotos novos testam a nave: segundos de ida, segundos de volta.',
      },
    },
    {
      home: 'hedus',
      faction: 'sun',
      at: { x: 733, y: 262 },
      zone: 2,
      name: { en: 'Hedus Test Pad', 'pt-BR': 'Plataforma de Testes de Hedus' },
      description: {
        en: 'A pad on the Hedus garrison ring where recruits take a ship up for a first, short flight: seconds out, seconds back.',
        'pt-BR':
          'Uma plataforma no anel da guarnição de Hedus, onde recrutas levam a nave para um primeiro voo curto: segundos de ida, segundos de volta.',
      },
    },
    {
      home: 'cair',
      faction: 'explorers',
      at: { x: 162, y: 482 },
      zone: 0,
      name: { en: 'Cair Test Pad', 'pt-BR': 'Plataforma de Testes de Cair' },
      description: {
        en: 'A scrap-built pad beside Cair Refuge where new explorers try their ship out: seconds out, seconds back.',
        'pt-BR':
          'Uma plataforma de sucata ao lado do Refúgio Cair, onde exploradores novos experimentam a nave: segundos de ida, segundos de volta.',
      },
    },
  ].map((pad): Place => ({
    id: `${pad.home}_pad`,
    name: pad.name,
    description: pad.description,
    type: 'test_pad',
    detail: 'local',
    x: pad.at.x,
    y: pad.at.y,
    zone: pad.zone,
    factionId: pad.faction,
    // the isolation of its zone (what the seed's zone map says for the places around it)
    isolation: pad.zone === 2 ? 1.4 : 0.9,
    services: LOCAL_SERVICES,
  })),
];

// Node ids stay lexicographically ordered (nodeAId < nodeBId), like every route.
const ROUTES: Array<{
  nodeAId: string;
  nodeBId: string;
  distance: number;
  danger: number;
  environment: string;
}> = [
  { nodeAId: 'ceres', nodeBId: 'ceres_dock', distance: 150, danger: 1, environment: 'open' },
  { nodeAId: 'tycho', nodeBId: 'tycho_slip', distance: 120, danger: 1, environment: 'open' },
  { nodeAId: 'vesta', nodeBId: 'vesta_heap', distance: 200, danger: 2, environment: 'debris' },
  { nodeAId: 'gate', nodeBId: 'gate_depot', distance: 180, danger: 3, environment: 'open' },
  { nodeAId: 'hedus', nodeBId: 'hedus_claim', distance: 240, danger: 3, environment: 'debris' },
  { nodeAId: 'marsa', nodeBId: 'marsa_station', distance: 130, danger: 3, environment: 'open' },
  // the test pads: seconds away, and safe
  { nodeAId: 'ceres', nodeBId: 'ceres_pad', distance: 30, danger: 0, environment: 'open' },
  { nodeAId: 'hedus', nodeBId: 'hedus_pad', distance: 30, danger: 0, environment: 'open' },
  { nodeAId: 'cair', nodeBId: 'cair_pad', distance: 30, danger: 0, environment: 'open' },
  { nodeAId: 'maw', nodeBId: 'thule', distance: 3000, danger: 10, environment: 'radiation' },
  {
    nodeAId: 'nadir',
    nodeBId: 'obsidian',
    distance: 3200,
    danger: 10,
    environment: 'gravitational',
  },
  { nodeAId: 'cinder', nodeBId: 'veil', distance: 3400, danger: 9, environment: 'debris' },
  { nodeAId: 'lantern', nodeBId: 'thule', distance: 2800, danger: 10, environment: 'radiation' },
  {
    nodeAId: 'lantern',
    nodeBId: 'nadir',
    distance: 3100,
    danger: 10,
    environment: 'gravitational',
  },
];

const FAR_ORIGIN_FACTIONS = ['luna', 'sun', 'explorers', 'pirates'];

const TEMPLATES: Array<{
  id: string;
  displayName: Text;
  description: Text;
  type: 'DELIVERY' | 'TRANSPORT' | 'MINING';
  factionId: string;
  requirements: Record<string, unknown>;
}> = [
  {
    id: 'haul_far',
    displayName: { en: 'Long Haul', 'pt-BR': 'Carga de Longa Distância' },
    description: {
      en: 'Carry sealed cargo to a station at the edge of the charts. It wants a long-range ship and a full tank.',
      'pt-BR':
        'Leve carga lacrada a uma estação na borda das cartas. Pede uma nave de longo alcance e o tanque cheio.',
    },
    type: 'DELIVERY',
    factionId: 'explorers',
    requirements: { destinationTypes: ['far_station'], originFactions: FAR_ORIGIN_FACTIONS },
  },
  {
    id: 'passage_far',
    displayName: { en: 'Far Passage', 'pt-BR': 'Passagem Distante' },
    description: {
      en: 'Passengers who want to go where the maps run out. The pay is good and the way back is yours to find.',
      'pt-BR':
        'Passageiros que querem ir aonde os mapas acabam. O pagamento é bom e o caminho de volta fica por sua conta.',
    },
    type: 'TRANSPORT',
    factionId: 'explorers',
    requirements: { destinationTypes: ['far_station'], originFactions: FAR_ORIGIN_FACTIONS },
  },
  {
    id: 'mining_claim_sun',
    displayName: { en: 'Claim Work', 'pt-BR': 'Trabalho na Concessão' },
    description: {
      en: 'Work a licensed claim for ore. Bring a mining rig and room to carry it.',
      'pt-BR':
        'Trabalhe uma concessão licenciada atrás de minério. Leve uma mineradora e espaço para carregá-lo.',
    },
    type: 'MINING',
    factionId: 'sun',
    requirements: { originFactions: ['sun'], originTypes: ['mining_claim'], cargo: 2 },
  },
  {
    id: 'mining_far_lantern',
    displayName: { en: 'Lantern Crystals', 'pt-BR': 'Cristais da Lanterna' },
    description: {
      en: 'Dig the purest crystal there is, past every beacon. A trip only a long-range ship can make.',
      'pt-BR':
        'Escave o cristal mais puro que existe, além de qualquer baliza. Uma viagem que só uma nave de longo alcance faz.',
    },
    type: 'MINING',
    factionId: 'explorers',
    requirements: {
      originFactions: ['explorers'],
      originTypes: ['far_field'],
      materialIds: ['rare_crystals'],
      cargo: 4,
    },
  },
  ...[
    { home: 'ceres', faction: 'luna' },
    { home: 'hedus', faction: 'sun' },
    { home: 'cair', faction: 'explorers' },
  ].map((pad) => ({
    id: `pad_return_${pad.home}`,
    displayName: { en: 'Back from the Pad', 'pt-BR': 'De Volta da Plataforma' },
    description: {
      en: 'A quick hop back to the port after a test flight.',
      'pt-BR': 'Um salto rápido de volta ao porto depois de um voo de teste.',
    },
    type: 'DELIVERY' as const,
    factionId: pad.faction,
    requirements: {
      originTypes: ['test_pad'],
      originFactions: [pad.faction],
      destinationIds: [pad.home],
    },
  })),
];

export async function seedMapExtension(prisma: PrismaClient): Promise<void> {
  const knownPlaces = new Set(
    (await prisma.location.findMany({ select: { id: true } })).map((row) => row.id),
  );
  for (const place of PLACES) {
    if (knownPlaces.has(place.id)) continue;
    await prisma.location.create({
      data: {
        id: place.id,
        displayName: place.name,
        description: place.description,
        type: place.type,
        detail: place.detail,
        x: place.x,
        y: place.y,
        zone: place.zone,
        factionId: place.factionId,
        isolation: place.isolation,
        mood: 1,
        services: place.services,
      },
    });
  }

  const knownRoutes = new Set(
    (await prisma.route.findMany({ select: { id: true } })).map((row) => row.id),
  );
  for (const route of ROUTES) {
    const id = `${route.nodeAId}-${route.nodeBId}`;
    if (knownRoutes.has(id)) continue;
    const ends = await prisma.location.count({
      where: { id: { in: [route.nodeAId, route.nodeBId] } },
    });
    if (ends !== 2) continue;
    await prisma.route.create({
      data: {
        id,
        nodeAId: route.nodeAId,
        nodeBId: route.nodeBId,
        distance: route.distance,
        danger: route.danger,
        routeEnvironments: { create: [{ environmentId: route.environment, order: 0 }] },
      },
    });
  }

  for (const template of TEMPLATES) {
    if ((await prisma.missionTemplate.findUnique({ where: { id: template.id } })) !== null)
      continue;
    await prisma.missionTemplate.create({
      data: {
        ...template,
        requirements: template.requirements as Prisma.InputJsonValue,
        rewardCalc: {},
        deadlineCalc: {},
        encounterPolicy:
          template.type === 'DELIVERY' || template.type === 'TRANSPORT'
            ? { missionForcesFlee: true }
            : {},
        active: true,
      },
    });
  }
}
