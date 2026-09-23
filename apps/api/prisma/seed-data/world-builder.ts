import type { PrismaClient } from '@prisma/client';
import { GAME_CONFIG_DEFAULTS } from '../../src/config/game-config.defaults.js';

// Prototype node data from prototypes/mapa-esboco.html (authoritative per D24).
const RAW_NODES: Record<
  string,
  {
    x: number;
    y: number;
    name: string;
    kind: string;
    dom: string;
    ctrl: Record<string, number>;
    risk: 'lo' | 'md' | 'hi';
    env: string;
  }
> = {
  ceres: {
    x: 250,
    y: 340,
    name: 'Porto Ceres',
    kind: 'Hub comercial',
    dom: 'luna',
    ctrl: { luna: 70, sun: 15, neutro: 15 },
    risk: 'lo',
    env: 'espaço aberto',
  },
  vesta: {
    x: 430,
    y: 210,
    name: 'Refinaria Vesta',
    kind: 'Posto industrial',
    dom: 'luna',
    ctrl: { luna: 55, explorers: 30, neutro: 15 },
    risk: 'lo',
    env: 'detritos leves',
  },
  tycho: {
    x: 170,
    y: 150,
    name: 'Estaleiro Tycho',
    kind: 'Hub / estaleiro',
    dom: 'luna',
    ctrl: { luna: 60, sun: 25, neutro: 15 },
    risk: 'lo',
    env: 'gravitacional',
  },
  gate: {
    x: 560,
    y: 370,
    name: 'Portão Kessler',
    kind: 'Entroncamento',
    dom: 'sun',
    ctrl: { sun: 50, luna: 35, neutro: 15 },
    risk: 'md',
    env: 'espaço aberto',
  },
  hedus: {
    x: 720,
    y: 250,
    name: 'Base Hedus',
    kind: 'Guarnição Sun',
    dom: 'sun',
    ctrl: { sun: 75, neutro: 25 },
    risk: 'md',
    env: 'espaço aberto',
  },
  marsa: {
    x: 840,
    y: 150,
    name: 'Ancoradouro Marsa',
    kind: 'Porto Sun',
    dom: 'sun',
    ctrl: { sun: 65, luna: 20, neutro: 15 },
    risk: 'md',
    env: 'gravitacional',
  },
  rennick: {
    x: 640,
    y: 520,
    name: 'Estação Rennick',
    kind: 'Posto isolado',
    dom: 'neutro',
    ctrl: { neutro: 45, explorers: 30, pirata: 25 },
    risk: 'md',
    env: 'radiação',
  },
  drift: {
    x: 820,
    y: 470,
    name: 'Campo Drift-9',
    kind: 'Campo de detritos',
    dom: 'pirata',
    ctrl: { pirata: 60, explorers: 25, neutro: 15 },
    risk: 'hi',
    env: 'detritos densos',
  },
  spur: {
    x: 410,
    y: 520,
    name: 'Fenda Spur',
    kind: 'Fronteira',
    dom: 'explorers',
    ctrl: { explorers: 55, neutro: 25, pirata: 20 },
    risk: 'md',
    env: 'radiação',
  },
  cair: {
    x: 150,
    y: 470,
    name: 'Refúgio Cair',
    kind: 'Posto Explorers',
    dom: 'explorers',
    ctrl: { explorers: 70, neutro: 30 },
    risk: 'lo',
    env: 'detritos leves',
  },
  veil: {
    x: 910,
    y: 610,
    name: 'O Véu',
    kind: 'Zona morta',
    dom: 'pirata',
    ctrl: { pirata: 80, neutro: 20 },
    risk: 'hi',
    env: 'radiação',
  },
  echo: {
    x: 520,
    y: 120,
    name: 'Eco-7',
    kind: 'Relé abandonado',
    dom: 'neutro',
    ctrl: { neutro: 50, sun: 25, pirata: 25 },
    risk: 'hi',
    env: 'detritos densos',
  },
};

// Prototype edge data; the duplicate ceres-cair is deduped during processing.
const RAW_EDGES: Array<[string, string, boolean?]> = [
  ['tycho', 'ceres'],
  ['tycho', 'vesta'],
  ['vesta', 'ceres'],
  ['vesta', 'echo'],
  ['ceres', 'cair'],
  ['ceres', 'gate'],
  ['cair', 'spur'],
  ['spur', 'rennick'],
  ['gate', 'hedus'],
  ['gate', 'rennick'],
  ['hedus', 'marsa'],
  ['hedus', 'echo'],
  ['rennick', 'drift', true],
  ['drift', 'veil', true],
  ['spur', 'drift', true],
  ['echo', 'drift', true],
  ['marsa', 'drift', true],
  ['cair', 'ceres'],
];

const TYPE_MAP: Readonly<Record<string, string>> = {
  'Hub comercial': 'port',
  'Posto industrial': 'outpost',
  'Hub / estaleiro': 'shipyard',
  Entroncamento: 'junction',
  'Guarnição Sun': 'garrison',
  'Porto Sun': 'port',
  'Posto isolado': 'outpost',
  'Campo de detritos': 'scrap_field',
  Fronteira: 'frontier',
  'Posto Explorers': 'outpost',
  'Zona morta': 'dead_zone',
  'Relé abandonado': 'relay',
};

const ENV_MAP: Readonly<Record<string, string>> = {
  'espaço aberto': 'open',
  'detritos leves': 'debris',
  'detritos densos': 'debris',
  gravitacional: 'gravitational',
  radiação: 'radiation',
};

const RISK_DANGER: Readonly<Record<string, number>> = { lo: 2, md: 5, hi: 8 };
const PLAYABLE_FACTIONS = new Set(['luna', 'sun', 'explorers']);

function resolveFactionId(raw: { dom: string; ctrl: Record<string, number> }): string {
  if (raw.dom !== 'neutro') {
    return raw.dom === 'pirata' ? 'pirates' : raw.dom;
  }
  const entries = Object.entries(raw.ctrl).filter(([faction]) => faction !== 'neutro');
  entries.sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return 'pirates';
  }
  const [topFaction] = entries[0]!;
  const pirateValue = raw.ctrl['pirata'] ?? 0;
  if (pirateValue >= 50) {
    return 'pirates';
  }
  return topFaction === 'pirata' ? 'pirates' : topFaction;
}

function deriveZone(raw: { risk: 'lo' | 'md' | 'hi'; ctrl: Record<string, number> }): number {
  if (raw.risk === 'hi' || (raw.ctrl['pirata'] ?? 0) >= 50) {
    return 3;
  }
  if (raw.risk === 'md') {
    return 2;
  }
  // For lo locations, a single playable faction holding >55% is zone 0; contested lo is zone 1.
  const playableShares = Object.entries(raw.ctrl)
    .filter(([faction]) => PLAYABLE_FACTIONS.has(faction))
    .map(([, value]) => value);
  const dominant = playableShares.length > 0 ? Math.max(...playableShares) : 0;
  return dominant > 55 ? 0 : 1;
}

function stableHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) / 0x7fffffff;
}

function computeMood(locationId: string, seed: string): number {
  const { mood_min: min, mood_max: max } = GAME_CONFIG_DEFAULTS.economy;
  const t = stableHash(`${seed}:${locationId}`);
  return min + t * (max - min);
}

function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const raw = Math.round(Math.sqrt(dx * dx + dy * dy) * 2.5);
  return Math.max(400, Math.min(1200, raw));
}

function routeEnvironmentId(
  nodeAEnv: string,
  nodeARisk: 'lo' | 'md' | 'hi',
  nodeBEnv: string,
  nodeBRisk: 'lo' | 'md' | 'hi',
): string {
  const riskOrder: Readonly<Record<'lo' | 'md' | 'hi', number>> = { lo: 0, md: 1, hi: 2 };
  if (riskOrder[nodeARisk] === riskOrder[nodeBRisk]) {
    if (nodeAEnv === 'open' && nodeBEnv === 'open') {
      return 'open';
    }
    return nodeAEnv !== 'open' ? nodeAEnv : nodeBEnv;
  }
  return riskOrder[nodeARisk] > riskOrder[nodeBRisk] ? nodeAEnv : nodeBEnv;
}

export async function seedWorld(prisma: PrismaClient): Promise<void> {
  const seed = GAME_CONFIG_DEFAULTS.world.seed;
  const isolationMult = GAME_CONFIG_DEFAULTS.economy.isolation_mult as Record<string, number>;

  for (const [id, raw] of Object.entries(RAW_NODES)) {
    const factionId = resolveFactionId(raw);
    const zone = deriveZone(raw);
    const existing = await prisma.location.findUnique({ where: { id } });
    if (existing === null) {
      await prisma.location.create({
        data: {
          id,
          displayName: { en: englishName(raw.name), 'pt-BR': raw.name },
          description: {
            en: `${englishName(raw.name)} — a ${(TYPE_MAP[raw.kind] ?? 'outpost').replaceAll('_', ' ')} in the sector.`,
            // raw.kind is already the Portuguese label; the TYPE_MAP slug is English.
            'pt-BR': `${raw.name} — ${raw.kind.toLowerCase()} no setor.`,
          },
          type: TYPE_MAP[raw.kind] ?? 'outpost',
          x: raw.x,
          y: raw.y,
          zone,
          factionId,
          isolation: isolationMult[String(zone)] ?? 1.0,
          mood: computeMood(id, seed),
          services: {
            buy: true,
            sell: true,
            repair: true,
            missions: true,
            passengers: true,
          },
        },
      });
    }
  }

  const seenEdges = new Set<string>();
  for (const [rawA, rawB, hot] of RAW_EDGES) {
    const nodeAId = rawA < rawB ? rawA : rawB;
    const nodeBId = rawA < rawB ? rawB : rawA;
    const edgeId = `${nodeAId}-${nodeBId}`;
    if (seenEdges.has(edgeId)) {
      continue;
    }
    seenEdges.add(edgeId);

    const nodeA = RAW_NODES[nodeAId]!;
    const nodeB = RAW_NODES[nodeBId]!;
    const distance = distanceBetween(nodeA, nodeB);
    const baseDanger = Math.max(RISK_DANGER[nodeA.risk] ?? 0, RISK_DANGER[nodeB.risk] ?? 0);
    const danger = Math.min(10, baseDanger + (hot ? 1 : 0));

    const existing = await prisma.route.findUnique({ where: { id: edgeId } });
    if (existing === null) {
      await prisma.route.create({
        data: {
          id: edgeId,
          nodeAId,
          nodeBId,
          distance,
          danger,
        },
      });

      const dominantEnv = routeEnvironmentId(
        ENV_MAP[nodeA.env] ?? 'open',
        nodeA.risk,
        ENV_MAP[nodeB.env] ?? 'open',
        nodeB.risk,
      );
      await prisma.routeEnvironment.create({
        data: {
          routeId: edgeId,
          environmentId: dominantEnv,
          order: 0,
        },
      });
    }
  }
}

function englishName(portugueseName: string): string {
  const map: Readonly<Record<string, string>> = {
    'Porto Ceres': 'Ceres Port',
    'Refinaria Vesta': 'Vesta Refinery',
    'Estaleiro Tycho': 'Tycho Shipyard',
    'Portão Kessler': 'Kessler Gate',
    'Base Hedus': 'Hedus Base',
    'Ancoradouro Marsa': 'Marsa Anchorage',
    'Estação Rennick': 'Rennick Station',
    'Campo Drift-9': 'Drift-9 Field',
    'Fenda Spur': 'Spur Rift',
    'Refúgio Cair': 'Cair Refuge',
    'O Véu': 'The Veil',
    'Eco-7': 'Echo-7',
  };
  return map[portugueseName] ?? portugueseName;
}
