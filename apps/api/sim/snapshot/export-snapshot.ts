/**
 * Reads the live database once and writes `sim-data/snapshot.json`, the only input every
 * simulation run uses. This is the one file in the simulation allowed to touch Prisma.
 *
 *   set -a; . ./.env; set +a; pnpm sim export
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { GAME_CONFIG_DEFAULTS } from '../../src/config/game-config.defaults.js';
import { validateGameRules } from '../../src/config/game-rules.schema.js';
import type { GameRules } from '../../src/config/game-config.types.js';
import { SIM_DATA_DIR, SNAPSHOT_PATH } from '../paths.js';
import type {
  CatalogRow,
  DropTableRow,
  EnvironmentRow,
  FactionRow,
  Json,
  LocationRow,
  MaterialRow,
  RouteEnvironmentRow,
  RouteRow,
  Snapshot,
  TemplateRow,
} from './types.js';

/**
 * The game merges a `GameConfig` row over the factory default by its dotted key
 * (`GameConfigService.mergeRows`); the same merge here means a snapshot's rules are
 * exactly the rules the running game would use.
 */
export function buildRules(rows: readonly { key: string; value: Json }[]): GameRules {
  const merged = structuredClone(GAME_CONFIG_DEFAULTS) as Record<string, unknown>;
  for (const row of rows) {
    const path = row.key.split('.');
    let current: Record<string, unknown> = merged;
    for (let index = 0; index < path.length - 1; index += 1) {
      const segment = path[index]!;
      const next = current[segment];
      if (typeof next !== 'object' || next === null) {
        throw new Error(`GameConfig key ${row.key} points at a missing group`);
      }
      current = next as Record<string, unknown>;
    }
    current[path[path.length - 1]!] = row.value;
  }
  return validateGameRules(merged);
}

const asJson = (value: unknown): Json => value as Json;

/** Reads the live database and writes `sim-data/snapshot.json`. Returns what it wrote. */
export async function exportSnapshot(): Promise<Snapshot> {
  const prisma = new PrismaClient();
  try {
    const rules = buildRules(await prisma.gameConfig.findMany({ select: { key: true, value: true } }));

    const [catalog, locations, routes, routeEnvironments, environments, templates, materials, dropTable, factions] =
      await Promise.all([
        prisma.partCatalog.findMany({
          // Connector layouts are the yard grid's business, not the economy's: the simulation
          // abstracts the layout away, so they only bloat the file.
          select: {
            partType: true,
            partClass: true,
            rarity: true,
            w: true,
            h: true,
            mass: true,
            structureCost: true,
            basePrice: true,
            scrapValue: true,
            partHp: true,
            pot: true,
            pdf: true,
            bli: true,
            esc: true,
            sen: true,
            crg: true,
            min: true,
            energyCont: true,
            energyCombat: true,
            fuelCap: true,
            fuelUse: true,
            batCharge: true,
            batOutput: true,
            batInput: true,
            specialProp: true,
            active: true,
          },
          orderBy: { partType: 'asc' },
        }),
        prisma.location.findMany({
          select: {
            id: true,
            displayName: true,
            description: true,
            type: true,
            x: true,
            y: true,
            zone: true,
            factionId: true,
            isolation: true,
            mood: true,
            services: true,
          },
          orderBy: { id: 'asc' },
        }),
        prisma.route.findMany({
          select: { id: true, nodeAId: true, nodeBId: true, distance: true, danger: true },
          orderBy: { id: 'asc' },
        }),
        prisma.routeEnvironment.findMany({
          select: { routeId: true, environmentId: true, order: true },
          orderBy: [{ routeId: 'asc' }, { order: 'asc' }],
        }),
        prisma.environment.findMany({
          select: {
            id: true,
            displayName: true,
            description: true,
            level: true,
            fuelMult: true,
            subsystemTarget: true,
            mitigatingPart: true,
          },
          orderBy: { id: 'asc' },
        }),
        prisma.missionTemplate.findMany({
          select: {
            id: true,
            displayName: true,
            description: true,
            type: true,
            factionId: true,
            requirements: true,
            rewardCalc: true,
            deadlineCalc: true,
            encounterPolicy: true,
            active: true,
          },
          orderBy: { id: 'asc' },
        }),
        prisma.material.findMany({
          select: {
            id: true,
            displayName: true,
            description: true,
            rarity: true,
            basePrice: true,
            fixedPrice: true,
            active: true,
          },
          orderBy: { id: 'asc' },
        }),
        prisma.dropTable.findMany({ select: { id: true, source: true, tiers: true }, orderBy: { id: 'asc' } }),
        prisma.faction.findMany({ select: { id: true, playable: true, relations: true }, orderBy: { id: 'asc' } }),
      ]);

    const snapshot: Snapshot = {
      takenAt: new Date().toISOString(),
      rules,
      catalog: catalog.map((row): CatalogRow => ({ ...row, specialProp: asJson(row.specialProp) })),
      locations: locations.map(
        (row): LocationRow => ({
          id: row.id,
          displayName: asJson(row.displayName),
          description: asJson(row.description),
          type: row.type,
          x: row.x,
          y: row.y,
          zone: row.zone,
          factionId: row.factionId,
          isolation: row.isolation,
          mood: row.mood,
          services: asJson(row.services),
        }),
      ),
      routes: routes.map((row): RouteRow => row),
      routeEnvironments: routeEnvironments.map((row): RouteEnvironmentRow => row),
      environments: environments.map((row): EnvironmentRow => row),
      templates: templates.map(
        (row): TemplateRow => ({
          id: row.id,
          displayName: asJson(row.displayName),
          description: asJson(row.description),
          type: row.type,
          factionId: row.factionId,
          requirements: asJson(row.requirements),
          rewardCalc: asJson(row.rewardCalc),
          deadlineCalc: asJson(row.deadlineCalc),
          encounterPolicy: asJson(row.encounterPolicy),
          active: row.active,
        }),
      ),
      materials: materials.map((row): MaterialRow => row),
      dropTable: dropTable.map((row): DropTableRow => ({ ...row, tiers: asJson(row.tiers) })),
      factions: factions.map(
        (row): FactionRow => ({ id: row.id, playable: row.playable, relations: asJson(row.relations) }),
      ),
    };

    await mkdir(SIM_DATA_DIR, { recursive: true });
    await writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

    console.log(
      `snapshot -> ${SNAPSHOT_PATH}\n` +
        `${snapshot.catalog.length} parts, ${snapshot.locations.length} locations, ` +
        `${snapshot.routes.length} routes, ${snapshot.templates.length} templates, ` +
        `${snapshot.materials.length} materials, taken at ${snapshot.takenAt}`,
    );
    return snapshot;
  } finally {
    await prisma.$disconnect();
  }
}
