import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { toJsonInput } from '../common/prisma-json.js';
import { GameConfigService } from '../config/game-config.service.js';
import type { GameRules } from '../config/game-config.types.js';
import type { ConnectorLayout } from '../parts/connectors.js';
import { pickCatalogStats } from '../parts/parts.service.js';
import type { InstalledPart, Placement } from '../parts/part.types.js';
import { autoLayout } from '../ships/auto-layout.js';
import { rollConnectorsForPartType } from '../parts/roll-connectors-for-part-type.js';
import { applyConnectivity } from '../ships/connectivity.js';
import { CLASSIC_SQUARE_CELLS, connectedPartIds } from '../ships/geometry.js';
import { deriveSheet } from '../ships/sheet.deriver.js';
import { checkViability, type ViabilityProblem } from '../ships/viability.js';

export interface ViabilityReport {
  readonly viable: boolean;
  readonly problems: ViabilityProblem[];
}

export interface RestartOutcome {
  readonly restartParts: string[];
  readonly viability: ViabilityReport;
  /** Tank ceiling of the hull as it stands after the check (kit or original build). */
  readonly fuelCap: number;
}

/**
 * S8.6: the restart floor (GDD §14 "peças de recomeço = sucata grátis"). A ship that is
 * no longer viable — only reachable by selling installed parts off an ADRIFT hull — is
 * rebuilt from the onboarding starter kit at `parts.restart_condition_max`, free of
 * charge. Nothing is destroyed: every old part is moved to the player's inventory
 * first, so the kit is strictly additive. The kit is laid out and viability-checked
 * exactly like onboarding, so the player always ends with a viable ship.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly config: GameConfigService) {}

  async ensureViableShip(
    tx: Prisma.TransactionClient,
    playerId: string,
    shipId: string,
  ): Promise<RestartOutcome> {
    const rules = this.config.snapshot().rules;
    const current = await this.installedOf(tx, shipId);
    const currentReport = this.viabilityOf(current, rules);
    if (currentReport.viable) {
      return {
        restartParts: [],
        viability: currentReport,
        fuelCap: deriveSheet(current, rules).fuelCap,
      };
    }

    for (const part of current) {
      await tx.partInstance.update({
        where: { id: part.instance.id },
        data: { location: 'INVENTORY', shipId: null },
      });
    }

    const starterParts = [...(rules.onboarding.starter_parts as string[])];
    const condition = rules.parts.restart_condition_max;
    // Sequential, in starter_parts order: cuid ids are not ordered by creation, so sorting
    // the kit by id would hand autoLayout a different sequence (and layout) per rescue.
    const kit = [];
    for (const partType of starterParts) {
      kit.push(
        await tx.partInstance.create({
          data: {
            partType,
            ownerPlayerId: playerId,
            condition,
            location: 'INVENTORY',
            connectors: toJsonInput(await rollConnectorsForPartType(tx, partType, true)),
          },
          include: { partCatalog: true },
        }),
      );
    }
    const kitParts = kit.map((part) => ({
      instance: part,
      catalog: pickCatalogStats(part.partCatalog),
    }));

    const catalogMap = new Map(kitParts.map((part) => [part.instance.id, part.catalog]));
    const layout = autoLayout(kitParts, catalogMap, CLASSIC_SQUARE_CELLS);
    if (layout.length !== kitParts.length) {
      throw new ConflictException({ error: 'AUTO_LAYOUT_OMITTED_PARTS' });
    }

    const kitConnectorsByInstance = new Map(
      kit.map((part) => [part.id, part.connectors as ConnectorLayout | null]),
    );
    const kitConnectedIds = connectedPartIds(layout, catalogMap, kitConnectorsByInstance);
    const kitPartsConnected = applyConnectivity(kitParts, kitConnectedIds);
    const kitSheet = deriveSheet(kitPartsConnected, rules);
    const viability = checkViability(kitSheet, kitPartsConnected, rules);
    if (!viability.viable) {
      throw new ConflictException({ error: 'SHIP_NOT_VIABLE', problems: viability.problems });
    }

    // The kit comes back loose (D44), like the onboarding kit: the pilot re-assembles in the
    // Hangar. The layout above only proves the kit can fly. Everything that was installed is
    // already back in inventory, so the hull is empty until the player assembles it.
    // The hull can drift in with more fuel than the kit's tank holds (the old tank was
    // sold off while ADRIFT, or swapped for a smaller one), so the stored fuel is clamped
    // to the new ceiling — fuel above fuelCap is unspendable at the pump (refuel sees no
    // need) yet reports as a full-plus tank everywhere the sheet is derived (S8.6 review).
    const shipRow = await tx.ship.findUniqueOrThrow({
      where: { id: shipId },
      select: { fuel: true },
    });
    const fuel = Math.min(shipRow.fuel, kitSheet.fuelCap);
    await tx.ship.update({
      where: { id: shipId },
      data: { layout: [], fuel },
    });

    return { restartParts: starterParts, viability, fuelCap: kitSheet.fuelCap };
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
