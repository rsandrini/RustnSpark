import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { toJsonInput } from '../common/prisma-json.js';
import { GameConfigService } from '../config/game-config.service.js';
import type { GameRules } from '../config/game-config.types.js';
import type { ConnectorLayout } from '../parts/connectors.js';
import { isDead } from '../parts/condition.js';
import { pickCatalogStats } from '../parts/parts.service.js';
import type { InstalledPart, Placement } from '../parts/part.types.js';
import { rollConnectorsForPartType } from '../parts/roll-connectors-for-part-type.js';
import { applyConnectivity } from '../ships/connectivity.js';
import { connectedPartIds } from '../ships/geometry.js';
import { deriveSheet } from '../ships/sheet.deriver.js';
import { checkViability, type ViabilityProblem } from '../ships/viability.js';

export interface ViabilityReport {
  readonly viable: boolean;
  readonly problems: ViabilityProblem[];
}

export interface RestartOutcome {
  /** The part types handed over (loose, in the inventory) for what was missing or dead. */
  readonly replacementParts: string[];
  readonly viability: ViabilityReport;
  /** Tank ceiling of the ship once the replacements are installed (installed tanks + the ones handed over). */
  readonly fuelCap: number;
}

/**
 * What a rescue hands over: loose common parts, at `parts.replacement_condition`, for the essential
 * roles that are missing or dead — a bridge, an engine, a tank (only when the ship burns fuel) and life
 * support (only with a passenger cabin). Nothing is installed or removed: the pilot swaps them in, and
 * the broken originals stay in the inventory. A ship that is fine gets nothing.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly config: GameConfigService) {}

  async provideReplacements(
    tx: Prisma.TransactionClient,
    playerId: string,
    shipId: string,
  ): Promise<RestartOutcome> {
    const rules = this.config.snapshot().rules;
    const current = await this.installedOf(tx, shipId);
    const alive = current.filter((part) => !isDead(Math.round(part.instance.condition), rules));
    const types = rules.parts.replacement_types;

    const wanted: string[] = [];
    if (
      !alive.some((part) => part.catalog.partClass === 'BRIDGE') &&
      types['bridge'] !== undefined
    ) {
      wanted.push(types['bridge']);
    }
    const engineType = types['engine'];
    let engineBurnsFuel = alive.some(
      (part) => part.catalog.partClass === 'ENGINE' && part.catalog.fuelUse > 0,
    );
    if (!alive.some((part) => part.catalog.partClass === 'ENGINE') && engineType !== undefined) {
      wanted.push(engineType);
      const row = await tx.partCatalog.findUnique({
        where: { partType: engineType },
        select: { fuelUse: true },
      });
      engineBurnsFuel = (row?.fuelUse ?? 0) > 0;
    }
    if (
      engineBurnsFuel &&
      !alive.some((part) => part.catalog.fuelCap > 0) &&
      types['tank'] !== undefined
    ) {
      wanted.push(types['tank']);
    }
    if (
      alive.some((part) => part.catalog.pressurized) &&
      !alive.some((part) => part.catalog.lifeSupport) &&
      types['life_support'] !== undefined
    ) {
      wanted.push(types['life_support']);
    }

    const handed: Array<{ partCatalog: { fuelCap: number | null } }> = [];
    for (const partType of wanted) {
      handed.push(
        await tx.partInstance.create({
          data: {
            partType,
            ownerPlayerId: playerId,
            condition: rules.parts.replacement_condition,
            location: 'INVENTORY',
            connectors: toJsonInput(await rollConnectorsForPartType(tx, partType, true)),
          },
          include: { partCatalog: { select: { fuelCap: true } } },
        }),
      );
    }
    const fuelCap =
      deriveSheet(current, rules).fuelCap +
      handed.reduce((sum, part) => sum + (part.partCatalog.fuelCap ?? 0), 0);
    return { replacementParts: wanted, viability: this.viabilityOf(current, rules), fuelCap };
  }

  private async installedOf(
    tx: Prisma.TransactionClient,
    shipId: string,
  ): Promise<InstalledPart[]> {
    const [rows, ship] = await Promise.all([
      tx.partInstance.findMany({
        where: { shipId, location: 'INSTALLED' },
        include: { partCatalog: true },
        orderBy: { id: 'asc' },
      }),
      tx.ship.findUniqueOrThrow({ where: { id: shipId }, select: { layout: true } }),
    ]);
    const installed = rows.map((row) => ({
      instance: row,
      catalog: pickCatalogStats(row.partCatalog),
    }));
    const catalogForConnectivity = new Map(installed.map((p) => [p.instance.id, p.catalog]));
    const connectorsByInstance = new Map(
      rows.map((row) => [row.id, row.connectors as ConnectorLayout | null]),
    );
    const connectedIds = connectedPartIds(
      (ship.layout as unknown as Placement[]) ?? [],
      catalogForConnectivity,
      connectorsByInstance,
    );
    return applyConnectivity(installed, connectedIds);
  }

  private viabilityOf(parts: InstalledPart[], rules: GameRules): ViabilityReport {
    const sheet = deriveSheet(parts, rules);
    const { viable, problems } = checkViability(sheet, parts, rules);
    return { viable, problems };
  }
}
