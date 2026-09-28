import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { PrismaClient } from '@prisma/client';
import { PARTS } from '../../prisma/seed-data/parts.js';
import { seed } from '../../prisma/seed.js';
import { closeTestPrismaClient, getTestPrismaClient, resetDatabase } from '../support/test-db.js';

const CANONICAL_FACTION_COLORS: Readonly<Record<string, string>> = {
  luna: '#4a90d9',
  sun: '#e3b341',
  explorers: '#3fa66a',
  pirates: '#c23b3b',
};

const ISOLATION_BY_ZONE: Readonly<Record<number, number>> = {
  0: 0.9,
  1: 1.0,
  2: 1.4,
  3: 2.0,
};

type RouteNode = { nodeAId: string; nodeBId: string };

function routeKey(a: string, b: string): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function isLocaleMap(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && 'en' in value && 'pt-BR' in value;
}

function assertLocaleMap(value: unknown): void {
  expect(isLocaleMap(value)).toBe(true);
  const map = value as Record<string, unknown>;
  expect(typeof map['en']).toBe('string');
  expect((map['en'] as string).length).toBeGreaterThan(0);
  expect(typeof map['pt-BR']).toBe('string');
  expect((map['pt-BR'] as string).length).toBeGreaterThan(0);
}

async function countRows(prisma: PrismaClient): Promise<Record<string, number>> {
  const [
    gameConfig,
    locations,
    routes,
    environments,
    factions,
    parts,
    materials,
    missionTemplates,
    dropTables,
  ] = await Promise.all([
    prisma.gameConfig.count(),
    prisma.location.count(),
    prisma.route.count(),
    prisma.environment.count(),
    prisma.faction.count(),
    prisma.partCatalog.count(),
    prisma.material.count(),
    prisma.missionTemplate.count(),
    prisma.dropTable.count(),
  ]);
  return {
    gameConfig,
    locations,
    routes,
    environments,
    factions,
    parts,
    materials,
    missionTemplates,
    dropTables,
  };
}

async function everyLocationCanServeATemplate(prisma: PrismaClient): Promise<boolean> {
  const locations = await prisma.location.findMany();
  const templates = await prisma.missionTemplate.findMany();
  for (const location of locations) {
    const canServe = templates.some((template) => {
      const requirements = template.requirements as Record<string, unknown> | undefined;
      const originFactions = requirements?.originFactions as string[] | undefined;
      const originTypes = requirements?.originTypes as string[] | undefined;
      const factionMatch =
        originFactions === undefined || originFactions.includes(location.factionId);
      const typeMatch = originTypes === undefined || originTypes.includes(location.type);
      return factionMatch && typeMatch;
    });
    if (!canServe) {
      return false;
    }
  }
  return true;
}

describe('database seed (S3.4)', () => {
  const prisma = getTestPrismaClient();
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
  });

  afterEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await closeTestPrismaClient();
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('seeds the expected catalog and world row counts', async () => {
    await seed(prisma);

    const counts = await countRows(prisma);
    expect(counts.gameConfig).toBe(116);
    expect(counts.locations).toBe(12);
    expect(counts.routes).toBe(17);
    expect(counts.environments).toBe(4);
    expect(counts.factions).toBe(4);
    expect(counts.parts).toBeGreaterThanOrEqual(12);
    // 3 ores + one fixed-price scrap material per scavengeable part (every part but the bridge).
    expect(counts.materials).toBe(3 + (PARTS.length - 1));
    expect(counts.missionTemplates).toBeGreaterThanOrEqual(5);
    expect(counts.dropTables).toBeGreaterThanOrEqual(3);
  });

  it('is idempotent: a second seed run makes no changes', async () => {
    await seed(prisma);
    const firstCounts = await countRows(prisma);

    await seed(prisma);
    const secondCounts = await countRows(prisma);

    expect(secondCounts).toEqual(firstCounts);
  });

  it('never overwrites an existing GameConfig or catalog row', async () => {
    await seed(prisma);

    const editedConfigValue = JSON.stringify({ custom: true });
    await prisma.gameConfig.update({
      where: { key: 'economy.start_credits' },
      data: { value: editedConfigValue },
    });

    const editedDisplayName = JSON.stringify({ en: 'Edited Part', 'pt-BR': 'Peça Editada' });
    await prisma.partCatalog.update({
      where: { partType: 'bridge' },
      data: { displayName: editedDisplayName },
    });

    await seed(prisma);

    const config = await prisma.gameConfig.findUnique({ where: { key: 'economy.start_credits' } });
    expect(config?.value).toEqual(editedConfigValue);

    const part = await prisma.partCatalog.findUnique({ where: { partType: 'bridge' } });
    expect(part?.displayName).toEqual(editedDisplayName);
  });

  it('connects all 12 locations as a single graph', async () => {
    await seed(prisma);

    const routes = await prisma.route.findMany({ select: { nodeAId: true, nodeBId: true } });
    const adjacency = new Map<string, string[]>();
    for (const { nodeAId, nodeBId } of routes as RouteNode[]) {
      adjacency.set(nodeAId, [...(adjacency.get(nodeAId) ?? []), nodeBId]);
      adjacency.set(nodeBId, [...(adjacency.get(nodeBId) ?? []), nodeAId]);
    }

    const start = 'ceres';
    const visited = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    expect(visited.size).toBe(12);
  });

  it('has no duplicate routes between the same unordered node pair', async () => {
    await seed(prisma);

    const routes = await prisma.route.findMany({ select: { nodeAId: true, nodeBId: true } });
    const seen = new Set<string>();
    for (const { nodeAId, nodeBId } of routes as RouteNode[]) {
      const key = routeKey(nodeAId, nodeBId);
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(17);
  });

  it('produces route distances in the 400–1,200 range', async () => {
    await seed(prisma);

    const routes = await prisma.route.findMany({ select: { distance: true } });
    for (const route of routes) {
      expect(route.distance).toBeGreaterThanOrEqual(400);
      expect(route.distance).toBeLessThanOrEqual(1200);
    }
  });

  it('covers every zone 0–3 and assigns isolation from the config map', async () => {
    await seed(prisma);

    const locations = await prisma.location.findMany({ select: { zone: true, isolation: true } });
    const zones = new Set<number>();
    for (const location of locations) {
      zones.add(location.zone);
      expect(location.isolation).toBe(ISOLATION_BY_ZONE[location.zone]);
    }
    expect(zones.has(0)).toBe(true);
    expect(zones.has(1)).toBe(true);
    expect(zones.has(2)).toBe(true);
    expect(zones.has(3)).toBe(true);
  });

  it('uses all four canonical environments on routes', async () => {
    await seed(prisma);

    const routeEnvironments = await prisma.routeEnvironment.findMany({
      select: { environmentId: true },
    });
    const used = new Set(routeEnvironments.map((re) => re.environmentId));
    expect(used.has('open')).toBe(true);
    expect(used.has('debris')).toBe(true);
    expect(used.has('gravitational')).toBe(true);
    expect(used.has('radiation')).toBe(true);
  });

  it('seeds factions with canonical colors and relations', async () => {
    await seed(prisma);

    const factions = await prisma.faction.findMany();
    for (const faction of factions) {
      expect(faction.color).toBe(CANONICAL_FACTION_COLORS[faction.id]);
    }

    const pirates = factions.find((f) => f.id === 'pirates');
    expect(pirates).toBeDefined();
    const pirateRelations = pirates!.relations as Record<string, string>;
    expect(pirateRelations).toEqual({
      luna: 'hostile',
      sun: 'hostile',
      explorers: 'hostile',
      pirates: 'hostile',
    });

    for (const faction of factions.filter((f) => f.playable)) {
      const relations = faction.relations as Record<string, string>;
      expect(relations['pirates']).toBe('hostile');
      for (const other of factions.filter((f) => f.playable && f.id !== faction.id)) {
        expect(relations[other.id]).toBe('neutral');
      }
    }
  });

  it('seeds location descriptions that are actually translated, not English slugs in Portuguese text', async () => {
    await seed(prisma);

    const locations = await prisma.location.findMany();
    expect(locations.length).toBeGreaterThan(0);
    for (const row of locations) {
      const description = row.description as { en: string; 'pt-BR': string };
      expect(description['pt-BR']).not.toBe(description.en);
      expect(description['pt-BR']).not.toMatch(new RegExp(`\\b${row.type}\\b`));
      expect(description['pt-BR']).toMatch(/no setor\.$/);
    }
  });

  it('seeds non-empty en and pt-BR display names and descriptions for every locale entity', async () => {
    await seed(prisma);

    const factions = await prisma.faction.findMany();
    for (const row of factions) {
      assertLocaleMap(row.displayName);
      assertLocaleMap(row.description);
    }

    const environments = await prisma.environment.findMany();
    for (const row of environments) {
      assertLocaleMap(row.displayName);
      assertLocaleMap(row.description);
    }

    const locations = await prisma.location.findMany();
    for (const row of locations) {
      assertLocaleMap(row.displayName);
      assertLocaleMap(row.description);
    }

    const parts = await prisma.partCatalog.findMany();
    for (const row of parts) {
      assertLocaleMap(row.displayName);
      assertLocaleMap(row.description);
    }

    const materials = await prisma.material.findMany();
    for (const row of materials) {
      assertLocaleMap(row.displayName);
      assertLocaleMap(row.description);
    }

    const templates = await prisma.missionTemplate.findMany();
    for (const row of templates) {
      assertLocaleMap(row.displayName);
      assertLocaleMap(row.description);
    }

    const configs = await prisma.gameConfig.findMany();
    for (const row of configs) {
      assertLocaleMap(row.description);
    }
  });

  it('ensures every location can serve at least one mission template', async () => {
    await seed(prisma);

    expect(await everyLocationCanServeATemplate(prisma)).toBe(true);
  });

  // The existing bilingual check only proves "both locales are non-empty", which an English
  // string pasted into the pt-BR slot satisfies. This one fails on any seeded pt-BR text that is
  // identical to its English text, unless it is a proper name / loanword that is genuinely the
  // same in both languages (listed explicitly, so adding to it is a visible decision).
  it('never seeds an English sentence into a pt-BR slot (identical texts must be allow-listed names)', async () => {
    await seed(prisma);
    const SAME_IN_BOTH = new Set<string>([
      // proper names and loanwords
      'Luna',
      'Sun',
      'Explorers',
      // identical in Portuguese
      'Laser',
      'Radar',
    ]);
    const tables: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [
      { table: 'faction', rows: await prisma.faction.findMany() },
      { table: 'environment', rows: await prisma.environment.findMany() },
      { table: 'location', rows: await prisma.location.findMany() },
      { table: 'partCatalog', rows: await prisma.partCatalog.findMany() },
      { table: 'missionTemplate', rows: await prisma.missionTemplate.findMany() },
      { table: 'material', rows: await prisma.material.findMany() },
    ];
    const offenders: string[] = [];
    for (const { table, rows } of tables) {
      for (const row of rows) {
        for (const field of ['displayName', 'description']) {
          const value = row[field] as { en?: string; 'pt-BR'?: string } | undefined;
          if (value?.en === undefined || value['pt-BR'] === undefined) continue;
          if (value.en.trim().toLowerCase() === value['pt-BR'].trim().toLowerCase()) {
            if (!SAME_IN_BOTH.has(value.en.trim())) {
              offenders.push(
                `${table}.${String(row['id'] ?? row['partType'])}.${field}: "${value.en}"`,
              );
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
