import { cellKey, formatCellsFromJson } from './geometry.js';
import { toJsonInput } from '../common/prisma-json.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { PartCatalog as PrismaPartCatalog, PartInstance, Prisma, Ship } from '@prisma/client';
import { GameConfigService } from '../config/game-config.service.js';
import type { GameRules } from '../config/game-config.types.js';

import { OwnershipResolverRegistry } from '../common/guards/ownership-resolver.registry.js';
import type { ConnectorLayout } from '../parts/connectors.js';
import type { InstalledPart, PartCatalog, Placement } from '../parts/part.types.js';
import { PartsService, pickCatalogStats } from '../parts/parts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { autoLayout } from './auto-layout.js';
import { applyConnectivity } from './connectivity.js';
import { withDirectionProblems } from './direction.js';
import { routeCoverage, type RouteCoverage } from './route-coverage.js';
import { connectedPartIds, validateLayout } from './geometry.js';
import { deriveShipClass, type ShipClassType } from './ship-class.js';
import { deriveSheet } from './sheet.deriver.js';
import type { ShipSheet } from './sheet.types.js';
import { startingPools } from '../missions/resolution-input.js';
import { allocatePower, powerPartOf } from '../resolution/power/power.js';
import { checkViability, type ViabilityReport } from './viability.js';

// Mirrors the same ordering convention already established in part-upgrade.calculator.ts and
// apps/web's part-detail.tsx lowestRarity — a local copy, not a shared import, since
// ships.service.ts doesn't otherwise depend on economy/part-upgrade.calculator.ts.
const RARITY_ORDER: readonly string[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];

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
  energyMode: string;
  layout: Placement[];
  sheet: ShipSheet;
  shipClass: ShipClassType;
  /** The assembly yard the layout lives on; the client draws it, the server validates it. */
  yard: { cells: [number, number][] };
  /** Installed part instance ids with no compatible connector chain back to the bridge right
      now — still counted as mass/structure/HP, not contributing anything else. */
  disconnectedPartIds: string[];
  /** What the ship is doing now: drives the animated ship stage. */
  activity: ShipActivity;
  /** The sheet's range read as routes: how many a full tank crosses; null = no fuel burn. */
  routeCoverage: RouteCoverage | null;
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
  viability: ViabilityReport;
  /** How the ship's power would be shared while travelling: each kind of system's share of its need. */
  power?: { supply: number; demand: number; shares: Record<string, number> };
  /** What a fight would start with (shield, armor and hull pools, shield recovery per round) at
      the parts' current condition: worn or unconnected parts give less than the sheet's totals. */
  layers?: { shield: number; armor: number; hull: number; shieldRegen: number };
  layout: Placement[];
  omittedPartInstanceIds: string[];
  disconnectedPartIds: string[];
  routeCoverage: RouteCoverage | null;
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
      include: { format: { select: { cells: true } } },
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
    this.assertLayoutValid(layout, playerParts, ship);

    // Saving a layout never requires it to be flight-viable: a player mid-refit — say,
    // pulling a part to sell it in Port — needs to save the smaller layout to free the part
    // up, even though the ship can't fly yet. Viability is enforced separately, at the point
    // it actually matters: dispatch (missions/dispatch.service.ts), travel eligibility
    // (missions/travel.service.ts) and scavenge start (missions/scavenge-job.service.ts).

    await this.persistLayout(shipId, layout, playerParts, ship.fuel, rules);

    const updated = await this.loadShip(shipId);
    return this.toResponse(updated, rules);
  }

  async autoAssemble(shipId: string, partInstanceIds?: string[]): Promise<ShipResponse> {
    const { ship, rules } = await this.loadShipWithRules(shipId);
    this.assertCanModify(ship);

    const playerParts = await this.partsService.findPlayerParts(ship.ownerPlayerId);
    const candidateParts = this.filterCandidateParts(playerParts, partInstanceIds);
    const formatCells = formatCellsFromJson(ship.format.cells);
    const { layout, omitted } = arrange(candidateParts.map(toInstalledPart), formatCells);
    if (omitted.length > 0) {
      throw new BadRequestException({
        error: 'AUTO_LAYOUT_OMITTED_PARTS',
        omittedPartInstanceIds: omitted.map((part) => part.instance.id),
      });
    }

    this.assertLayoutValid(layout, playerParts, ship);
    // Same as assemble() above: saving never requires flight-viability.

    await this.persistLayout(shipId, layout, playerParts, ship.fuel, rules);

    const updated = await this.loadShip(shipId);
    return this.toResponse(updated, rules);
  }

  async preview(
    shipId: string,
    layout?: Placement[],
    partInstanceIds?: string[],
    virtualPart?: { partType: string; condition: number },
    replacePartInstanceId?: string,
  ): Promise<PreviewResponse> {
    const { ship, rules } = await this.loadShipWithRules(shipId);
    const playerParts = await this.partsService.findPlayerParts(ship.ownerPlayerId);

    if (virtualPart !== undefined) {
      return this.previewWithVirtualPart(ship, rules, playerParts, virtualPart, replacePartInstanceId);
    }

    let installed: InstalledPart[];
    let effectiveLayout: Placement[];
    let omittedPartInstanceIds: string[] = [];

    const formatCells = formatCellsFromJson(ship.format.cells);
    if (layout !== undefined && layout.length > 0) {
      this.assertLayoutValid(layout, playerParts, ship);
      effectiveLayout = layout;
      installed = this.buildInstalledParts(layout, playerParts);
    } else {
      const candidateParts = this.filterCandidateParts(playerParts, partInstanceIds);
      const arranged = arrange(candidateParts.map(toInstalledPart), formatCells);
      installed = arranged.placed;
      effectiveLayout = arranged.layout;
      omittedPartInstanceIds = arranged.omitted.map((part) => part.instance.id);
      this.assertLayoutValid(effectiveLayout, playerParts, ship);
    }

    const catalogForConnectivity = new Map(installed.map((p) => [p.instance.id, p.catalog]));
    const connectorsByInstance = new Map(
      playerParts.map((p) => [p.id, p.connectors as ConnectorLayout | null]),
    );
    const connectedIds = connectedPartIds(effectiveLayout, catalogForConnectivity, connectorsByInstance);
    const installedConnected = applyConnectivity(installed, connectedIds);
    const sheet = deriveSheet(installedConnected, rules);
    const viability = withDirectionProblems(
      checkViability(sheet, installedConnected, rules),
      effectiveLayout,
      catalogForConnectivity,
      connectorsByInstance,
    );
    const powerState = allocatePower(
      installedConnected.map((part) =>
        powerPartOf(part.instance.id, part.catalog, rules.power.idle_demand),
      ),
      'cruise',
      rules,
    );
    const pools = startingPools(
      installedConnected.map((part) => ({ condition: part.instance.condition, catalog: part.catalog })),
      rules,
    );
    return {
      sheet,
      shipClass: deriveShipClass(installedConnected, rules),
      viability,
      layers: {
        shield: pools.esc,
        armor: pools.armor,
        hull: pools.hp,
        shieldRegen: pools.escRegen,
      },
      power: {
        supply: powerState.supply,
        demand: powerState.demand,
        shares: powerState.byKind,
      },
      layout: effectiveLayout,
      omittedPartInstanceIds,
      routeCoverage: await this.routeCoverageFor(sheet),
      disconnectedPartIds: installed
        .filter((p) => !connectedIds.has(p.instance.id))
        .map((p) => p.instance.id),
    };
  }

  // Market-compare only: builds the sheet as if `virtualPart` (a catalog type the player does not
  // yet own) were installed in place of `replacePartInstanceId` (or simply added, when omitted).
  // Skips arrange()/assertLayoutValid() entirely — a stat preview needs no real grid slot, only
  // deriveSheet()'s per-part stat sums, so the virtual part's own condition is all it contributes.
  private async previewWithVirtualPart(
    ship: Ship,
    rules: GameRules,
    playerParts: PartInstanceWithCatalog[],
    virtualPart: { partType: string; condition: number },
    replacePartInstanceId?: string,
  ): Promise<PreviewResponse> {
    const catalogRow = await this.prisma.partCatalog.findUnique({
      where: { partType: virtualPart.partType },
    });
    if (!catalogRow || !catalogRow.active) {
      throw new NotFoundException('part type not found');
    }

    const installedReal = playerParts.filter(
      (part) =>
        part.location === 'INSTALLED' &&
        part.shipId === ship.id &&
        part.id !== replacePartInstanceId,
    );
    const synthetic: InstalledPart = {
      instance: {
        id: 'virtual',
        partType: virtualPart.partType,
        condition: virtualPart.condition,
      },
      catalog: pickCatalogStats(catalogRow),
    };
    const installed = [...installedReal.map(toInstalledPart), synthetic];
    const sheet = deriveSheet(installed, rules);
    const viability = checkViability(sheet, installed, rules);
    return {
      sheet,
      shipClass: deriveShipClass(installed, rules),
      viability,
      layout: (ship.layout as unknown as Placement[]) ?? [],
      omittedPartInstanceIds: [],
      disconnectedPartIds: [],
      routeCoverage: await this.routeCoverageFor(sheet),
    };
  }

  async setStance(shipId: string, stance: Ship['stance']): Promise<ShipResponse> {
    const { ship, rules } = await this.loadShipWithRules(shipId);
    this.assertCanModify(ship);

    const updated = await this.prisma.ship.update({
      where: { id: shipId },
      data: { stance },
      include: { format: { select: { cells: true } } },
    });
    return this.toResponse(updated, rules);
  }

  async setEnergyMode(shipId: string, energyMode: string): Promise<ShipResponse> {
    const { ship, rules } = await this.loadShipWithRules(shipId);
    this.assertCanModify(ship);

    const updated = await this.prisma.ship.update({
      where: { id: shipId },
      data: { energyMode },
      include: { format: { select: { cells: true } } },
    });
    return this.toResponse(updated, rules);
  }

  async listFormats(playerId: string): Promise<Array<{
    id: string;
    displayName: unknown;
    description: unknown;
    cells: [number, number][];
    minRarity: string;
  }>> {
    const ship = await this.prisma.ship.findFirst({ where: { ownerPlayerId: playerId } });
    const bridgeRarity = await this.currentBridgeRarity(ship);
    const rarityRank = RARITY_ORDER.indexOf(bridgeRarity);
    const formats = await this.prisma.shipFormat.findMany({ where: { active: true } });
    return formats
      .filter((format) => RARITY_ORDER.indexOf(format.minRarity) <= rarityRank)
      .map((format) => ({
        id: format.id,
        displayName: format.displayName,
        description: format.description,
        cells: format.cells as [number, number][],
        minRarity: format.minRarity,
      }));
  }

  async setFormat(shipId: string, formatId: string): Promise<ShipResponse> {
    const { ship, rules } = await this.loadShipWithRules(shipId);
    this.assertCanModify(ship);

    const target = await this.prisma.shipFormat.findUnique({ where: { id: formatId } });
    if (!target || !target.active) {
      throw new ConflictException({ error: 'FORMAT_NOT_UNLOCKED' });
    }
    const bridgeRarity = await this.currentBridgeRarity(ship);
    if (RARITY_ORDER.indexOf(target.minRarity) > RARITY_ORDER.indexOf(bridgeRarity)) {
      throw new ConflictException({ error: 'FORMAT_NOT_UNLOCKED' });
    }

    const playerParts = await this.partsService.findPlayerParts(ship.ownerPlayerId);
    const catalogMap = buildCatalogMapFromPrisma(playerParts);
    const newCells = formatCellsFromJson(target.cells);
    const currentLayout = (ship.layout as unknown as Placement[]) ?? [];

    const fits = (placement: Placement): boolean => {
      const part = catalogMap.get(placement.partInstanceId);
      if (part === undefined) return false;
      const swapped = placement.rot % HALF_TURN !== 0;
      const width = swapped ? part.h : part.w;
      const height = swapped ? part.w : part.h;
      for (let dx = 0; dx < width; dx += 1) {
        for (let dy = 0; dy < height; dy += 1) {
          if (!newCells.has(cellKey(placement.gx + dx, placement.gy + dy))) return false;
        }
      }
      return true;
    };
    const keptLayout = currentLayout.filter(fits);

    await this.prisma.$transaction(async (tx) => {
      await tx.ship.update({
        where: { id: shipId },
        data: { formatId, layout: toJsonInput(keptLayout) },
      });
      const droppedIds = currentLayout.filter((p) => !fits(p)).map((p) => p.partInstanceId);
      if (droppedIds.length > 0) {
        await tx.partInstance.updateMany({
          where: { id: { in: droppedIds } },
          data: { location: 'INVENTORY', shipId: null },
        });
      }
    });

    const updated = await this.loadShip(shipId);
    return this.toResponse(updated, rules);
  }

  private async currentBridgeRarity(ship: Ship | null): Promise<string> {
    if (ship === null) return 'COMMON';
    const bridgeInstalled = await this.prisma.partInstance.findFirst({
      where: { shipId: ship.id, location: 'INSTALLED', partCatalog: { partClass: 'BRIDGE' } },
      include: { partCatalog: true },
    });
    return bridgeInstalled?.partCatalog.rarity ?? 'COMMON';
  }

  private async loadShip(shipId: string): Promise<ShipWithFormat> {
    const ship = await this.prisma.ship.findUnique({
      where: { id: shipId },
      include: { format: { select: { cells: true } } },
    });
    if (!ship) throw new NotFoundException('ship not found');
    return ship;
  }

  private async loadShipWithRules(shipId: string): Promise<{ ship: ShipWithFormat; rules: GameRules }> {
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
    ship: ShipWithFormat,
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
      if (part.location === 'INSTALLED' && part.shipId !== ship.id) {
        throw new ConflictException('part is installed in another ship');
      }
    }

    const catalogMap = buildCatalogMapFromPrisma(playerParts);
    const connectorsByInstance = new Map(
      playerParts.map((p) => [p.id, p.connectors as ConnectorLayout | null]),
    );
    const geometryErrors = validateLayout(
      layout,
      catalogMap,
      formatCellsFromJson(ship.format.cells),
      connectorsByInstance,
    );
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
    currentFuel: number,
    rules: GameRules,
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
        // The fuel aboard can never exceed what the tanks that stay on the ship can hold: take
        // the tank off and its fuel goes with it (no tank left = an empty ship).
        data: {
          layout: toJsonInput(layout),
          fuel: Math.min(currentFuel, this.fuelCapOf(layout, playerParts, rules)),
        },
      });
    });
  }

  /** What the tanks of this layout can hold (connected, working tanks only). */
  private fuelCapOf(
    layout: Placement[],
    playerParts: PartInstanceWithCatalog[],
    rules: GameRules,
  ): number {
    const ids = new Set(layout.map((placement) => placement.partInstanceId));
    const rows = playerParts.filter((part) => ids.has(part.id));
    const installed = rows.map(toInstalledPart);
    const catalog = new Map(installed.map((part) => [part.instance.id, part.catalog]));
    const connectors = new Map(
      rows.map((row) => [row.id, row.connectors as ConnectorLayout | null]),
    );
    const connected = connectedPartIds(layout, catalog, connectors);
    return deriveSheet(applyConnectivity(installed, connected), rules).fuelCap;
  }

  private async toResponse(ship: ShipWithFormat, rules: GameRules): Promise<ShipResponse> {
    const parts = await this.partsService.findPlayerParts(ship.ownerPlayerId);
    const installedRows = parts.filter(
      (part) => part.location === 'INSTALLED' && part.shipId === ship.id,
    );
    const installed = installedRows.map(toInstalledPart);
    const shipLayout = (ship.layout as unknown as Placement[]) ?? [];
    const catalogForConnectivity = new Map(installed.map((p) => [p.instance.id, p.catalog]));
    const connectorsByInstance = new Map(
      installedRows.map((row) => [row.id, row.connectors as ConnectorLayout | null]),
    );
    const connectedIds = connectedPartIds(shipLayout, catalogForConnectivity, connectorsByInstance);
    const installedConnected = applyConnectivity(installed, connectedIds);
    const sheet = deriveSheet(installedConnected, rules);
    const activity = await this.activityOf(ship);
    return {
      id: ship.id,
      ownerPlayerId: ship.ownerPlayerId,
      name: ship.name,
      fuel: ship.fuel,
      status: ship.status,
      currentLocationId: ship.currentLocationId,
      stance: ship.stance,
      energyMode: ship.energyMode,
      layout: shipLayout,
      sheet,
      shipClass: deriveShipClass(installedConnected, rules),
      disconnectedPartIds: installedRows
        .filter((row) => !connectedIds.has(row.id))
        .map((row) => row.id),
      yard: { cells: ship.format.cells as [number, number][] },
      activity,
      routeCoverage: await this.routeCoverageFor(sheet),
    };
  }

  // The sheet's range as "covers N of M routes": every route's distance with its harshest
  // environment's fuel multiplier, so it follows whatever the Admin tunes on routes/environments.
  private async routeCoverageFor(sheet: ShipSheet): Promise<RouteCoverage | null> {
    if (sheet.fuelUse <= 0) return null;
    const routes = await this.prisma.route.findMany({
      select: {
        distance: true,
        routeEnvironments: { select: { environment: { select: { fuelMult: true } } } },
      },
    });
    return routeCoverage(
      sheet,
      routes.map((route) => ({
        distance: route.distance,
        envFuelMult: Math.max(1, ...route.routeEnvironments.map((link) => link.environment.fuelMult)),
      })),
    );
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

type ShipWithFormat = Prisma.ShipGetPayload<{
  include: { format: { select: { cells: true } } };
}>;

const HALF_TURN = 180;

function toInstalledPart(part: PartInstanceWithCatalog): InstalledPart {
  return { instance: part, catalog: pickCatalogStats(part.partCatalog) };
}

// autoLayout may leave parts out when they do not fit; callers must derive and check the sheet
// from `placed` (what is actually saved), never from the requested list.
function arrange(
  requested: InstalledPart[],
  formatCells: ReadonlySet<string>,
): {
  layout: Placement[];
  placed: InstalledPart[];
  omitted: InstalledPart[];
} {
  const layout = autoLayout(requested, buildCatalogMap(requested), formatCells);
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
