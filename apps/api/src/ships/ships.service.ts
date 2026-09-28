import { GRID_HALF_SIZE } from './geometry.js';
import { toJsonInput } from '../common/prisma-json.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { PartCatalog as PrismaPartCatalog, PartInstance, Ship } from '@prisma/client';
import { GameConfigService } from '../config/game-config.service.js';
import type { GameRules } from '../config/game-config.types.js';

import { OwnershipResolverRegistry } from '../common/guards/ownership-resolver.registry.js';
import type { InstalledPart, PartCatalog, Placement } from '../parts/part.types.js';
import { PartsService, pickCatalogStats } from '../parts/parts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { autoLayout } from './auto-layout.js';
import { validateLayout } from './geometry.js';
import { deriveShipClass, type ShipClassType } from './ship-class.js';
import { deriveSheet } from './sheet.deriver.js';
import type { ShipSheet } from './sheet.types.js';
import { checkViability, type ViabilityProblem } from './viability.js';

/** What the ship is doing now (drives the ship stage on the client). */
export interface ShipActivity {
  readonly kind: 'idle' | 'flying' | 'scavenging' | 'repairing';
  /** When it ends (arrival or repair completion), if it does. */
  readonly until: string | null;
  readonly missionId: string | null;
}

export interface ShipResponse {
  id: string;
  ownerPlayerId: string;
  name: string;
  fuel: number;
  status: string;
  currentLocationId: string;
  stance: string;
  layout: Placement[];
  sheet: ShipSheet;
  shipClass: ShipClassType;
  /** The assembly yard the layout lives on; the client draws it, the server validates it. */
  yard: { halfSize: number };
  /** What the ship is doing now: drives the animated ship stage. */
  activity: ShipActivity;
}

/** What the ship is doing now (flying, scavenging, repairing or idle). */
export interface ShipActivity {
  readonly kind: 'idle' | 'flying' | 'scavenging' | 'repairing';
  /** When it ends (arrival or repair completion), if it does. */
  readonly until: string | null;
  readonly missionId: string | null;
}

export interface PreviewResponse {
  sheet: ShipSheet;
  shipClass: ShipClassType;
  viability: { viable: boolean; problems: ViabilityProblem[] };
  layout: Placement[];
  omittedPartInstanceIds: string[];
}

@Injectable()
export class ShipsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly partsService: PartsService,
    private readonly configService: GameConfigService,
    private readonly ownershipRegistry: OwnershipResolverRegistry,
  ) {}

  onModuleInit(): void {
    this.ownershipRegistry.register('ship', async (shipId: string) => {
      const ship = await this.prisma.ship.findUnique({
        where: { id: shipId },
        select: { ownerPlayerId: true },
      });
      return ship ? { ownerPlayerId: ship.ownerPlayerId } : null;
    });
  }

  async findByPlayer(playerId: string): Promise<ShipResponse[]> {
    const ships = await this.prisma.ship.findMany({
      where: { ownerPlayerId: playerId },
      orderBy: { id: 'asc' },
    });
    const rules = this.configService.snapshot().rules;
    return Promise.all(ships.map((ship) => this.toResponse(ship, rules)));
  }

  async findById(shipId: string): Promise<ShipResponse> {
    const ship = await this.loadShip(shipId);
    const rules = this.configService.snapshot().rules;
    return this.toResponse(ship, rules);
  }

  async assemble(shipId: string, layout: Placement[]): Promise<ShipResponse> {
    const { ship, rules } = await this.loadShipWithRules(shipId);
    this.assertCanModify(ship);

    const playerParts = await this.partsService.findPlayerParts(ship.ownerPlayerId);
    this.assertLayoutValid(layout, playerParts, shipId);

    // Saving a layout never requires it to be flight-viable: a player mid-refit — say,
    // pulling a part to sell it in Port — needs to save the smaller layout to free the part
    // up, even though the ship can't fly yet. Viability is enforced separately, at the point
    // it actually matters: dispatch (missions/dispatch.service.ts), travel eligibility
    // (missions/travel.service.ts) and scavenge start (missions/scavenge-job.service.ts).

    await this.persistLayout(shipId, layout, playerParts);

    const updated = await this.loadShip(shipId);
    return this.toResponse(updated, rules);
  }

  async autoAssemble(shipId: string, partInstanceIds?: string[]): Promise<ShipResponse> {
    const { ship, rules } = await this.loadShipWithRules(shipId);
    this.assertCanModify(ship);

    const playerParts = await this.partsService.findPlayerParts(ship.ownerPlayerId);
    const candidateParts = this.filterCandidateParts(playerParts, partInstanceIds);
    const { layout, omitted } = arrange(candidateParts.map(toInstalledPart));
    if (omitted.length > 0) {
      throw new BadRequestException({
        error: 'AUTO_LAYOUT_OMITTED_PARTS',
        omittedPartInstanceIds: omitted.map((part) => part.instance.id),
      });
    }

    this.assertLayoutValid(layout, playerParts, shipId);
    // Same as assemble() above: saving never requires flight-viability.

    await this.persistLayout(shipId, layout, playerParts);

    const updated = await this.loadShip(shipId);
    return this.toResponse(updated, rules);
  }

  async preview(
    shipId: string,
    layout?: Placement[],
    partInstanceIds?: string[],
  ): Promise<PreviewResponse> {
    const { ship, rules } = await this.loadShipWithRules(shipId);
    const playerParts = await this.partsService.findPlayerParts(ship.ownerPlayerId);

    let installed: InstalledPart[];
    let effectiveLayout: Placement[];
    let omittedPartInstanceIds: string[] = [];

    if (layout !== undefined && layout.length > 0) {
      this.assertLayoutValid(layout, playerParts, shipId);
      effectiveLayout = layout;
      installed = this.buildInstalledParts(layout, playerParts);
    } else {
      const candidateParts = this.filterCandidateParts(playerParts, partInstanceIds);
      const arranged = arrange(candidateParts.map(toInstalledPart));
      installed = arranged.placed;
      effectiveLayout = arranged.layout;
      omittedPartInstanceIds = arranged.omitted.map((part) => part.instance.id);
      this.assertLayoutValid(effectiveLayout, playerParts, shipId);
    }

    const sheet = deriveSheet(installed, rules);
    const viability = checkViability(sheet, installed, rules);
    return {
      sheet,
      shipClass: deriveShipClass(installed, rules),
      viability,
      layout: effectiveLayout,
      omittedPartInstanceIds,
    };
  }

  async setStance(shipId: string, stance: Ship['stance']): Promise<ShipResponse> {
    const { ship, rules } = await this.loadShipWithRules(shipId);
    this.assertCanModify(ship);

    const updated = await this.prisma.ship.update({
      where: { id: shipId },
      data: { stance },
    });
    return this.toResponse(updated, rules);
  }

  private async loadShip(shipId: string): Promise<Ship> {
    const ship = await this.prisma.ship.findUnique({ where: { id: shipId } });
    if (!ship) throw new NotFoundException('ship not found');
    return ship;
  }

  private async loadShipWithRules(shipId: string): Promise<{ ship: Ship; rules: GameRules }> {
    const ship = await this.loadShip(shipId);
    const rules = this.configService.snapshot().rules;
    return { ship, rules };
  }

  private assertCanModify(ship: Ship): void {
    if (ship.status === 'ON_MISSION') {
      throw new ConflictException({ error: 'SHIP_ON_MISSION' });
    }
  }

  private assertLayoutValid(
    layout: Placement[],
    playerParts: PartInstanceWithCatalog[],
    shipId: string,
  ): void {
    const layoutIds = new Set(layout.map((placement) => placement.partInstanceId));
    if (layoutIds.size !== layout.length) {
      throw new BadRequestException({
        error: 'INVALID_LAYOUT',
        message: 'duplicate part instance in layout',
      });
    }

    for (const placement of layout) {
      const part = playerParts.find((p) => p.id === placement.partInstanceId);
      if (!part) {
        throw new ForbiddenException('layout references a part not owned by player');
      }
      if (part.location === 'INSTALLED' && part.shipId !== shipId) {
        throw new ConflictException('part is installed in another ship');
      }
    }

    const catalogMap = buildCatalogMapFromPrisma(playerParts);
    const geometryErrors = validateLayout(layout, catalogMap);
    if (geometryErrors.length > 0) {
      throw new BadRequestException({
        error: 'INVALID_LAYOUT',
        problems: geometryErrors.map((error) => ({ code: error.code, message: error.message })),
      });
    }
  }

  private buildInstalledParts(
    layout: Placement[],
    playerParts: PartInstanceWithCatalog[],
  ): InstalledPart[] {
    return layout
      .map((placement) => {
        const part = playerParts.find((p) => p.id === placement.partInstanceId);
        return part ? toInstalledPart(part) : null;
      })
      .filter((part): part is InstalledPart => part !== null);
  }

  private filterCandidateParts(
    playerParts: PartInstanceWithCatalog[],
    partInstanceIds?: string[],
  ): PartInstanceWithCatalog[] {
    if (partInstanceIds === undefined || partInstanceIds.length === 0) {
      return playerParts.filter((part) => part.location === 'INVENTORY');
    }
    const allowed = new Set(partInstanceIds);
    const owned = new Set(playerParts.map((part) => part.id));
    if ([...allowed].some((id) => !owned.has(id))) {
      throw new ForbiddenException('request references a part not owned by player');
    }
    return playerParts.filter((part) => allowed.has(part.id));
  }

  private async persistLayout(
    shipId: string,
    layout: Placement[],
    playerParts: PartInstanceWithCatalog[],
  ): Promise<void> {
    const layoutIds = new Set(layout.map((placement) => placement.partInstanceId));
    const previouslyInstalled = playerParts.filter(
      (part) => part.location === 'INSTALLED' && part.shipId === shipId,
    );
    const toInventory = previouslyInstalled.filter((part) => !layoutIds.has(part.id));

    await this.prisma.$transaction(async (tx) => {
      for (const part of toInventory) {
        await tx.partInstance.update({
          where: { id: part.id },
          data: { location: 'INVENTORY', shipId: null },
        });
      }
      for (const placement of layout) {
        await tx.partInstance.update({
          where: { id: placement.partInstanceId },
          data: { location: 'INSTALLED', shipId },
        });
      }
      await tx.ship.update({
        where: { id: shipId },
        data: { layout: toJsonInput(layout) },
      });
    });
  }

  private async toResponse(ship: Ship, rules: GameRules): Promise<ShipResponse> {
    const parts = await this.partsService.findPlayerParts(ship.ownerPlayerId);
    const installed = parts
      .filter((part) => part.location === 'INSTALLED' && part.shipId === ship.id)
      .map(toInstalledPart);
    const sheet = deriveSheet(installed, rules);
    const activity = await this.activityOf(ship);
    return {
      id: ship.id,
      ownerPlayerId: ship.ownerPlayerId,
      name: ship.name,
      fuel: ship.fuel,
      status: ship.status,
      currentLocationId: ship.currentLocationId,
      stance: ship.stance,
      layout: (ship.layout as unknown as Placement[]) ?? [],
      sheet,
      shipClass: deriveShipClass(installed, rules),
      yard: { halfSize: GRID_HALF_SIZE },
      activity,
    };
  }

  /**
   * What the ship is doing right now, for the animated ship stage: flying (a mission or a trip in
   * flight), scavenging (a scavenging job), repairing (a pending repair job) or idle. Read from the
   * mission and repair rows, so it can never disagree with them.
   */
  private async activityOf(ship: Ship): Promise<ShipActivity> {
    const [mission, repair] = await Promise.all([
      this.prisma.missionInstance.findFirst({
        where: { shipId: ship.id, status: { in: ['IN_TRANSIT', 'RESOLVING'] } },
        select: { id: true, type: true, arrivalAt: true },
      }),
      this.prisma.repairJob.findFirst({
        where: { shipId: ship.id, status: 'PENDING' },
        select: { completesAt: true },
      }),
    ]);
    if (mission !== null) {
      return {
        kind: (mission.type as string) === 'SCAVENGE' ? 'scavenging' : 'flying',
        until: mission.arrivalAt?.toISOString() ?? null,
        missionId: mission.id,
      };
    }
    if (repair !== null) {
      return { kind: 'repairing', until: repair.completesAt.toISOString(), missionId: null };
    }
    return { kind: 'idle', until: null, missionId: null };
  }
}

type PartInstanceWithCatalog = PartInstance & { partCatalog: PrismaPartCatalog };

function toInstalledPart(part: PartInstanceWithCatalog): InstalledPart {
  return { instance: part, catalog: pickCatalogStats(part.partCatalog) };
}

// autoLayout may leave parts out when they do not fit; callers must derive and check the sheet
// from `placed` (what is actually saved), never from the requested list.
function arrange(requested: InstalledPart[]): {
  layout: Placement[];
  placed: InstalledPart[];
  omitted: InstalledPart[];
} {
  const layout = autoLayout(requested, buildCatalogMap(requested));
  const placedIds = new Set(layout.map((placement) => placement.partInstanceId));
  return {
    layout,
    placed: requested.filter((part) => placedIds.has(part.instance.id)),
    omitted: requested.filter((part) => !placedIds.has(part.instance.id)),
  };
}

function buildCatalogMapFromPrisma(
  parts: PartInstanceWithCatalog[],
): ReadonlyMap<string, PartCatalog> {
  const map = new Map<string, PartCatalog>();
  for (const part of parts) {
    map.set(part.id, pickCatalogStats(part.partCatalog));
  }
  return map;
}

function buildCatalogMap(parts: InstalledPart[]): ReadonlyMap<string, PartCatalog> {
  const map = new Map<string, PartCatalog>();
  for (const part of parts) {
    map.set(part.instance.id, part.catalog);
  }
  return map;
}
