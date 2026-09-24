import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { GameConfigService } from '../config/game-config.service.js';
import type { GameRules } from '../config/game-config.types.js';
import { pickCatalogStats } from '../parts/parts.service.js';
import type { InstalledPart } from '../parts/part.types.js';
import { autoLayout } from '../ships/auto-layout.js';
import { deriveSheet } from '../ships/sheet.deriver.js';
import { checkViability, type ViabilityProblem } from '../ships/viability.js';

export interface ViabilityReport {
  readonly viable: boolean;
  readonly problems: ViabilityProblem[];
}

export interface RestartOutcome {
  readonly restartParts: string[];
  readonly viability: ViabilityReport;
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
      return { restartParts: [], viability: currentReport };
    }

    for (const part of current) {
      await tx.partInstance.update({
        where: { id: part.instance.id },
        data: { location: 'INVENTORY', shipId: null },
      });
    }

    const starterParts = [...(rules.onboarding.starter_parts as string[])];
    const condition = rules.parts.restart_condition_max;
    const created = await Promise.all(
      starterParts.map((partType) =>
        tx.partInstance.create({
          data: {
            partType,
            ownerPlayerId: playerId,
            condition,
            location: 'INVENTORY',
          },
        }),
      ),
    );

    const kit = await tx.partInstance.findMany({
      where: { id: { in: created.map((part) => part.id) } },
      include: { partCatalog: true },
      orderBy: { id: 'asc' },
    });
    const kitParts = kit.map((part) => ({
      instance: part,
      catalog: pickCatalogStats(part.partCatalog),
    }));

    const catalogMap = new Map(kitParts.map((part) => [part.instance.id, part.catalog]));
    const layout = autoLayout(kitParts, catalogMap);
    if (layout.length !== kitParts.length) {
      throw new ConflictException({ error: 'AUTO_LAYOUT_OMITTED_PARTS' });
    }

    const viability = this.viabilityOf(kitParts, rules);
    if (!viability.viable) {
      throw new ConflictException({ error: 'SHIP_NOT_VIABLE', problems: viability.problems });
    }

    for (const placement of layout) {
      await tx.partInstance.update({
        where: { id: placement.partInstanceId },
        data: { location: 'INSTALLED', shipId },
      });
    }
    await tx.ship.update({ where: { id: shipId }, data: { layout: layout as unknown as never } });

    return { restartParts: starterParts, viability };
  }

  private async installedOf(
    tx: Prisma.TransactionClient,
    shipId: string,
  ): Promise<InstalledPart[]> {
    const rows = await tx.partInstance.findMany({
      where: { shipId, location: 'INSTALLED' },
      include: { partCatalog: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({ instance: row, catalog: pickCatalogStats(row.partCatalog) }));
  }

  private viabilityOf(parts: InstalledPart[], rules: GameRules): ViabilityReport {
    const sheet = deriveSheet(parts, rules);
    const { viable, problems } = checkViability(sheet, parts, rules);
    return { viable, problems };
  }
}
