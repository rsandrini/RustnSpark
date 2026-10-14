import type { PrismaClient } from '@prisma/client';

// The far zones (owner, 2026-10-14): three distant places beyond the settled map, reached by long
// routes through hostile space, where the only thing worth digging is rare crystals and it is hard
// to get. They give the late game its own content: a long trip through the most dangerous routes of
// the map (danger 8-10, radiation and gravity), then a dig whose per-attempt chance is low (a rare
// material in a radiation / gravitational field). They sit in zone 3, the top danger tier: the zone
// scale (0-3) is a database rule and the pirate / scavenging tables are keyed by it. Like every seed
// they only FILL what is missing: whatever an admin edited stays.

const FAR_FACTION = 'explorers';
const FAR_PLACE_TYPE = 'deep_field';
// The isolation of zone 3 in `economy.isolation_by_zone`: the far places price like the top tier.
const FAR_ISOLATION = 2;
const NO_SERVICES = {
  buy: false,
  sell: false,
  repair: false,
  missions: false,
  passengers: false,
};

interface FarPlace {
  id: string;
  name: { en: string; 'pt-BR': string };
  description: { en: string; 'pt-BR': string };
  x: number;
  y: number;
  zone: number;
}

const PLACES: FarPlace[] = [
  {
    id: 'halcyon',
    name: { en: 'Halcyon Reach', 'pt-BR': 'Alcance Halcyon' },
    description: {
      en: 'A cold shoal of crystal-bearing rock past the last settled relay. Nobody lives here; the survey crews that did not come back left their charts.',
      'pt-BR':
        'Um banco frio de rocha com cristais depois do último relé habitado. Ninguém mora aqui; as equipes de prospecção que não voltaram deixaram seus mapas.',
    },
    x: 1100,
    y: 360,
    zone: 3,
  },
  {
    id: 'obsidian',
    name: { en: 'Obsidian Shoal', 'pt-BR': 'Baixio Obsidiana' },
    description: {
      en: 'Black glass rock under a gravity well that wrings engines and fuel. The crystal veins are rich, and almost impossible to hold on to.',
      'pt-BR':
        'Rocha de vidro negro sob um poço gravitacional que castiga motores e combustível. As veias de cristal são ricas, e quase impossíveis de segurar.',
    },
    x: 1230,
    y: 560,
    zone: 3,
  },
  {
    id: 'maw',
    name: { en: 'The Maw', 'pt-BR': 'A Goela' },
    description: {
      en: 'The farthest charted place: a ring of radiation and gravity around a dead star. Only the best-built ships come back with anything.',
      'pt-BR':
        'O lugar mais distante já cartografado: um anel de radiação e gravidade em volta de uma estrela morta. Só as naves mais bem construídas voltam com alguma coisa.',
    },
    x: 1400,
    y: 400,
    zone: 3,
  },
];

// Node ids stay lexicographically ordered (nodeAId < nodeBId), like every route.
const ROUTES: Array<{
  id: string;
  nodeAId: string;
  nodeBId: string;
  distance: number;
  danger: number;
  environments: string[];
}> = [
  {
    id: 'drift-halcyon',
    nodeAId: 'drift',
    nodeBId: 'halcyon',
    distance: 2200,
    danger: 8,
    environments: ['radiation'],
  },
  {
    id: 'halcyon-obsidian',
    nodeAId: 'halcyon',
    nodeBId: 'obsidian',
    distance: 1800,
    danger: 9,
    environments: ['gravitational'],
  },
  {
    id: 'maw-obsidian',
    nodeAId: 'maw',
    nodeBId: 'obsidian',
    distance: 2600,
    danger: 10,
    environments: ['radiation', 'gravitational'],
  },
];

const MINING_TEMPLATE = {
  id: 'mining_far_crystals',
  type: 'MINING' as const,
  factionId: FAR_FACTION,
  displayName: { en: 'Deep crystal dig', 'pt-BR': 'Escavação de cristais profundos' },
  description: {
    en: 'Dig rare crystals out of a far, hostile field. The trip is long and the vein is stingy.',
    'pt-BR':
      'Escave cristais raros em um campo distante e hostil. A viagem é longa e a veia é avarenta.',
  },
  requirements: {
    originFactions: [FAR_FACTION],
    originTypes: [FAR_PLACE_TYPE],
    materialIds: ['rare_crystals'],
    cargo: 4,
  },
};

export async function seedFarZones(prisma: PrismaClient): Promise<void> {
  const existing = new Set(
    (await prisma.location.findMany({ select: { id: true } })).map((row) => row.id),
  );
  for (const place of PLACES) {
    if (existing.has(place.id)) continue;
    await prisma.location.create({
      data: {
        id: place.id,
        displayName: place.name,
        description: place.description,
        type: FAR_PLACE_TYPE,
        x: place.x,
        y: place.y,
        zone: place.zone,
        factionId: FAR_FACTION,
        isolation: FAR_ISOLATION,
        mood: 1,
        services: NO_SERVICES,
      },
    });
  }

  const knownRoutes = new Set(
    (await prisma.route.findMany({ select: { id: true } })).map((row) => row.id),
  );
  for (const route of ROUTES) {
    if (knownRoutes.has(route.id)) continue;
    // A route needs both ends: the drift is part of the settled world, the others are ours.
    const ends = await prisma.location.count({
      where: { id: { in: [route.nodeAId, route.nodeBId] } },
    });
    if (ends !== 2) continue;
    await prisma.route.create({
      data: {
        id: route.id,
        nodeAId: route.nodeAId,
        nodeBId: route.nodeBId,
        distance: route.distance,
        danger: route.danger,
        routeEnvironments: {
          create: route.environments.map((environmentId, order) => ({ environmentId, order })),
        },
      },
    });
  }

  const template = await prisma.missionTemplate.findUnique({ where: { id: MINING_TEMPLATE.id } });
  if (template === null) {
    await prisma.missionTemplate.create({
      data: {
        id: MINING_TEMPLATE.id,
        type: MINING_TEMPLATE.type,
        factionId: MINING_TEMPLATE.factionId,
        displayName: MINING_TEMPLATE.displayName,
        description: MINING_TEMPLATE.description,
        requirements: MINING_TEMPLATE.requirements,
        rewardCalc: {},
        deadlineCalc: {},
        encounterPolicy: {},
        active: true,
      },
    });
  }
}
