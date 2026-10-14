import {
  RESCUE_BASE_TYPES,
  rescuePrices,
  towPlanFor,
  type FloatSpot,
  type TowPlan,
} from './floating.js';
import { clampLevels } from '../resolution/engine/engine.js';
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
import { autoLayout, extendLayout } from './auto-layout.js';
import { computeHold, type HoldState } from './hold.js';
import { applyConnectivity, conductiveCatalog, withConnectionProblem } from './connectivity.js';
import { withDirectionProblems } from './direction.js';
import { routeCoverage, type RouteCoverage } from './route-coverage.js';
import { connectedPartIds, incorrectPortPartIds, validateLayout } from './geometry.js';
import { deriveShipClass, type ShipClassType } from './ship-class.js';
import { deriveSheet } from './sheet.deriver.js';
import type { ShipSheet } from './sheet.types.js';
import { startingPools } from '../missions/resolution-input.js';
import { allocatePower, powerPartOf } from '../resolution/power/power.js';
import { checkViability, type ViabilityReport } from './viability.js';

// Mirrors the same ordering convention already established in part-upgrade.calculator.ts and
// apps/web's part-detail.tsx lowestRarity — a local copy, not a shared import, since
// ships.service.ts doesn't otherwise depend on economy/part-upgrade.calculator.ts.
import { formatChangePending, formatsForBridge } from './bridge-format.js';

const RARITY_ORDER: readonly string[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY'];

/**
 * Whether the bridge opens a format. Rarity and size are two orthogonal gates: the format's
 * `minRarity` must be at or below the bridge's rarity, and the bridge footprint (both axes) must
 * be at least the format's `minBridgeSize` — so a COMMON 2x2 unlocks the big grids while a RARE
 * 1x1 stays on the small ones.
 */
function formatUnlocked(
  format: { minRarity: string; minBridgeSize: number },
  bridge: { rarity: string; w: number; h: number },
): boolean {
  const byRarity = RARITY_ORDER.indexOf(format.minRarity) <= RARITY_ORDER.indexOf(bridge.rarity);
  const bySize = format.minBridgeSize <= bridge.w && format.minBridgeSize <= bridge.h;
  return byRarity && bySize;
}

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
  /** Engine tuning set on the bridge (1 = engines as listed). */
  engineLevels: { chem: number; ion: number };
  /** The spare parts the ship carries against the bridge's slots (and a mission's cargo against its space). */
  hold: HoldState;
  layout: Placement[];
  /** The ship's current assembly yard (ship format). */
  formatId: string;
  /** The bridge changed: a format has to be picked again (from the new bridge's level) before leaving port. */
  formatChangeRequired: boolean;
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
  /** Where an out-of-fuel ship floats (null otherwise, or when the spot was not recorded). */
  float: { routeId: string; fromId: string; toId: string; progress: number } | null;
  /** The ways out for a floating ship: what each costs and where the tow ends. */
  rescue: RescueOptions | null;
}

export interface RescueOptions {
  /** Waiting for the rescue. */
  waitCost: number;
  /** Calling it now. */
  nowCost: number;
  /** How long waiting takes (mission time, seconds). */
  waitSeconds: number;
  /** When the waiting rescue arrives; null until the pilot calls it. */
  dueAt: string | null;
  /** The base the ship is towed to and how far it is from where the ship floats. */
  baseId: string;
  baseDistance: number;
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
      include: { format: { select: { cells: true, minBridgeSize: true } } },
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
    this.assertBridgeFitsFormat(layout, playerParts, ship);
    this.assertLayoutValid(layout, playerParts, ship);

    // Saving a layout never requires it to be flight-viable: a player mid-refit — say,
    // pulling a part to sell it in Port — needs to save the smaller layout to free the part
    // up, even though the ship can't fly yet. Viability is enforced separately, at the point
    // it actually matters: dispatch (missions/dispatch.service.ts), travel eligibility
    // (missions/travel.service.ts) and scavenge start (missions/scavenge-job.service.ts).

    await this.persistLayout(shipId, layout, playerParts, ship.fuel, rules, ship.formatBridgeType);

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

    this.assertBridgeFitsFormat(layout, playerParts, ship);
    this.assertLayoutValid(layout, playerParts, ship);
    // Same as assemble() above: saving never requires flight-viability.

    await this.persistLayout(shipId, layout, playerParts, ship.fuel, rules, ship.formatBridgeType);

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
      return this.previewWithVirtualPart(
        ship,
        rules,
        playerParts,
        virtualPart,
        replacePartInstanceId,
      );
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
      const candidates = candidateParts.map(toInstalledPart);
      const current = (ship.layout as unknown as Placement[] | null) ?? [];
      const candidateIds = new Set(candidates.map((part) => part.instance.id));
      const kept = current.filter((placement) => candidateIds.has(placement.partInstanceId));
      if (kept.length > 0) {
        // The ship already stands: keep its real arrangement and only try to seat the parts it does
        // not hold yet, so a comparison measures the part and not a re-pack of the whole ship.
        const keptIds = new Set(kept.map((placement) => placement.partInstanceId));
        const added = candidates.filter((part) => !keptIds.has(part.instance.id));
        effectiveLayout = extendLayout(kept, added, candidates, formatCells);
        const placedIds = new Set(effectiveLayout.map((placement) => placement.partInstanceId));
        installed = candidates.filter((part) => placedIds.has(part.instance.id));
        omittedPartInstanceIds = candidates
          .filter((part) => !placedIds.has(part.instance.id))
          .map((part) => part.instance.id);
      } else {
        const arranged = arrange(candidates, formatCells);
        installed = arranged.placed;
        effectiveLayout = arranged.layout;
        omittedPartInstanceIds = arranged.omitted.map((part) => part.instance.id);
      }
      this.assertLayoutValid(effectiveLayout, playerParts, ship);
    }

    const catalogForConnectivity = new Map(installed.map((p) => [p.instance.id, p.catalog]));
    const connectorsByInstance = new Map(
      playerParts.map((p) => [p.id, p.connectors as ConnectorLayout | null]),
    );
    const connectedIds = connectedPartIds(
      effectiveLayout,
      conductiveCatalog(catalogForConnectivity, installed, rules),
      connectorsByInstance,
    );
    const installedConnected = applyConnectivity(installed, connectedIds);
    const sheet = deriveSheet(installedConnected, rules);
    const viability = withDirectionProblems(
      withConnectionProblem(
        checkViability(sheet, installedConnected, rules),
        installed,
        connectedIds,
        incorrectPortPartIds(effectiveLayout, catalogForConnectivity, connectorsByInstance),
      ),
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
      installedConnected.map((part) => ({
        condition: part.instance.condition,
        catalog: part.catalog,
      })),
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
      include: { format: { select: { cells: true, minBridgeSize: true } } },
    });
    return this.toResponse(updated, rules);
  }

  async setEnergyMode(shipId: string, energyMode: string): Promise<ShipResponse> {
    const { ship, rules } = await this.loadShipWithRules(shipId);
    this.assertCanModify(ship);

    const updated = await this.prisma.ship.update({
      where: { id: shipId },
      data: { energyMode },
      include: { format: { select: { cells: true, minBridgeSize: true } } },
    });
    return this.toResponse(updated, rules);
  }

  async setEngineLevels(shipId: string, chem: number, ion: number): Promise<ShipResponse> {
    const { ship, rules } = await this.loadShipWithRules(shipId);
    this.assertCanModify(ship);
    const levels = clampLevels({ chem, ion }, rules);
    const updated = await this.prisma.ship.update({
      where: { id: shipId },
      data: { chemLevel: levels.chem, ionLevel: levels.ion },
      include: { format: { select: { cells: true, minBridgeSize: true } } },
    });
    return this.toResponse(updated, rules);
  }

  async listFormats(playerId: string): Promise<
    Array<{
      id: string;
      displayName: unknown;
      description: unknown;
      cells: [number, number][];
      minRarity: string;
      minBridgeSize: number;
    }>
  > {
    const ship = await this.prisma.ship.findFirst({ where: { ownerPlayerId: playerId } });
    const bridge = await this.currentBridge(ship);
    const formats = await this.prisma.shipFormat.findMany({ where: { active: true } });
    const unlocked = formats.filter((format) => formatUnlocked(format, bridge));
    // After a bridge change only the new bridge's own level is on offer.
    const offered =
      ship !== null && (await this.formatChangePendingOf(ship))
        ? formatsForBridge(unlocked, bridge)
        : unlocked;
    return offered.map((format) => ({
      id: format.id,
      displayName: format.displayName,
      description: format.description,
      cells: format.cells as [number, number][],
      minRarity: format.minRarity,
      minBridgeSize: format.minBridgeSize,
    }));
  }

  async setFormat(shipId: string, formatId: string): Promise<ShipResponse> {
    const { ship, rules } = await this.loadShipWithRules(shipId);
    this.assertCanModify(ship);

    const target = await this.prisma.shipFormat.findUnique({ where: { id: formatId } });
    if (!target || !target.active) {
      throw new ConflictException({ error: 'FORMAT_NOT_UNLOCKED' });
    }
    const bridge = await this.currentBridge(ship);
    if (!formatUnlocked(target, bridge)) {
      throw new ConflictException({ error: 'FORMAT_NOT_UNLOCKED' });
    }
    if (await this.formatChangePendingOf(ship)) {
      const allFormats = await this.prisma.shipFormat.findMany({ where: { active: true } });
      const offered = formatsForBridge(
        allFormats.filter((format) => formatUnlocked(format, bridge)),
        bridge,
      );
      if (!offered.some((format) => format.id === formatId)) {
        throw new ConflictException({ error: 'FORMAT_NOT_UNLOCKED' });
      }
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
        data: {
          formatId,
          layout: toJsonInput(keptLayout),
          formatBridgeType: await this.installedBridgeType(ship.id),
        },
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

  private async installedBridgeType(shipId: string): Promise<string | null> {
    const bridge = await this.prisma.partInstance.findFirst({
      where: { shipId, location: 'INSTALLED', partCatalog: { partClass: 'BRIDGE' } },
      select: { partType: true },
    });
    return bridge?.partType ?? null;
  }

  /** The bridge is not the one the ship's format was picked for: a new pick is required. */
  private async formatChangePendingOf(
    ship: Pick<Ship, 'id' | 'formatBridgeType'>,
  ): Promise<boolean> {
    return formatChangePending(ship.formatBridgeType, await this.installedBridgeType(ship.id));
  }

  /** The installed bridge's rarity and grid footprint; a ship with none reads as a 1x1 COMMON. */
  private async currentBridge(
    ship: Ship | null,
  ): Promise<{ rarity: string; w: number; h: number }> {
    if (ship === null) return { rarity: 'COMMON', w: 1, h: 1 };
    const bridgeInstalled = await this.prisma.partInstance.findFirst({
      where: { shipId: ship.id, location: 'INSTALLED', partCatalog: { partClass: 'BRIDGE' } },
      include: { partCatalog: true },
    });
    if (bridgeInstalled === null) return { rarity: 'COMMON', w: 1, h: 1 };
    return {
      rarity: bridgeInstalled.partCatalog.rarity,
      w: bridgeInstalled.partCatalog.w,
      h: bridgeInstalled.partCatalog.h,
    };
  }

  private async loadShip(shipId: string): Promise<ShipWithFormat> {
    const ship = await this.prisma.ship.findUnique({
      where: { id: shipId },
      include: { format: { select: { cells: true, minBridgeSize: true } } },
    });
    if (!ship) throw new NotFoundException('ship not found');
    return ship;
  }

  private async loadShipWithRules(
    shipId: string,
  ): Promise<{ ship: ShipWithFormat; rules: GameRules }> {
    const ship = await this.loadShip(shipId);
    const rules = this.configService.snapshot().rules;
    return { ship, rules };
  }

  private assertCanModify(ship: Ship): void {
    if (ship.status === 'ON_MISSION') {
      throw new ConflictException({ error: 'SHIP_ON_MISSION' });
    }
  }

  /**
   * A format may only be left for a smaller bridge once the layout has already dropped to a
   * bridge that still satisfies the current format's size floor — so a COMMON 2x2 can't be
   * downswapped to a 1x1 while the ship still sits on a big (minBridgeSize 2) grid. The layout
   * being saved carries the new bridge, so we check it against the format's requirement.
   */
  private assertBridgeFitsFormat(
    layout: Placement[],
    playerParts: PartInstanceWithCatalog[],
    ship: ShipWithFormat,
  ): void {
    const required = ship.format.minBridgeSize;
    if (required <= 1) return;
    const catalogMap = buildCatalogMapFromPrisma(playerParts);
    const bridge = layout.find((placement) => {
      const part = catalogMap.get(placement.partInstanceId);
      return part?.partClass === 'BRIDGE';
    });
    if (bridge === undefined) return; // no bridge in the layout: assertLayoutValid owns that case
    const part = catalogMap.get(bridge.partInstanceId);
    if (part === undefined) return;
    const swapped = bridge.rot % HALF_TURN !== 0;
    const w = swapped ? part.h : part.w;
    const h = swapped ? part.w : part.h;
    if (w < required || h < required) {
      throw new ConflictException({ error: 'FORMAT_REQUIRES_BRIDGE' });
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
    shipFormatBridgeType: string | null,
  ): Promise<void> {
    const layoutIds = new Set(layout.map((placement) => placement.partInstanceId));
    const previouslyInstalled = playerParts.filter(
      (part) => part.location === 'INSTALLED' && part.shipId === shipId,
    );
    const toInventory = previouslyInstalled.filter((part) => !layoutIds.has(part.id));
    const bridgeAfter = playerParts.find(
      (part) => layoutIds.has(part.id) && part.partCatalog.partClass === 'BRIDGE',
    );
    const recordBaseline = shipFormatBridgeType === null;

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
          // The first bridge a ship gets is its baseline: nothing to re-pick yet.
          ...(recordBaseline && bridgeAfter !== undefined
            ? { formatBridgeType: bridgeAfter.partType }
            : {}),
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
    const connected = connectedPartIds(
      layout,
      conductiveCatalog(catalog, installed, rules),
      connectors,
    );
    return deriveSheet(applyConnectivity(installed, connected), rules).fuelCap;
  }

  /** Where an adrift ship floats and what its rescue would cost (shared with the rescue itself). */
  async adriftOf(
    ship: {
      readonly currentLocationId: string;
      readonly floatRouteId: string | null;
      readonly floatFromId: string | null;
      readonly floatProgress: number | null;
      readonly rescueAt: Date | null;
    },
    rules: GameRules,
  ): Promise<{ float: ShipResponse['float']; rescue: RescueOptions; plan: TowPlan }> {
    const [routes, locations] = await Promise.all([
      this.prisma.route.findMany(),
      this.prisma.location.findMany({ select: { id: true, type: true } }),
    ]);
    const baseIds = new Set(
      locations.filter((place) => RESCUE_BASE_TYPES.has(place.type)).map((place) => place.id),
    );
    const spot: FloatSpot | null =
      ship.floatRouteId !== null && ship.floatFromId !== null && ship.floatProgress !== null
        ? { routeId: ship.floatRouteId, fromId: ship.floatFromId, progress: ship.floatProgress }
        : null;
    // A ship that went adrift before positions were recorded stays where it is docked on the map.
    const plan = (spot === null ? null : towPlanFor(spot, routes, baseIds)) ?? {
      baseId: ship.currentLocationId,
      distance: 0,
    };
    const edge = spot === null ? undefined : routes.find((route) => route.id === spot.routeId);
    const prices = rescuePrices(plan.distance, rules);
    return {
      float:
        spot === null || edge === undefined
          ? null
          : {
              routeId: spot.routeId,
              fromId: spot.fromId,
              toId: edge.nodeAId === spot.fromId ? edge.nodeBId : edge.nodeAId,
              progress: spot.progress,
            },
      rescue: {
        waitCost: prices.wait,
        nowCost: prices.now,
        waitSeconds: rules.economy.rescue_wait_seconds,
        dueAt: ship.rescueAt === null ? null : ship.rescueAt.toISOString(),
        baseId: plan.baseId,
        baseDistance: Math.round(plan.distance),
      },
      plan,
    };
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
    const connectedIds = connectedPartIds(
      shipLayout,
      conductiveCatalog(catalogForConnectivity, installed, rules),
      connectorsByInstance,
    );
    const installedConnected = applyConnectivity(installed, connectedIds);
    const sheet = deriveSheet(installedConnected, rules);
    const hold = computeHold({
      slots: rules.ship.spare_part_slots,
      parts: parts.filter((part) => part.location === 'INVENTORY').length,
      capacity: sheet.crg,
    });
    const activity = await this.activityOf(ship);
    const adrift = ship.status === 'ADRIFT' ? await this.adriftOf(ship, rules) : null;
    return {
      float: adrift?.float ?? null,
      rescue: adrift?.rescue ?? null,
      id: ship.id,
      ownerPlayerId: ship.ownerPlayerId,
      name: ship.name,
      fuel: ship.fuel,
      status: ship.status,
      currentLocationId: ship.currentLocationId,
      stance: ship.stance,
      energyMode: ship.energyMode,
      engineLevels: { chem: ship.chemLevel, ion: ship.ionLevel },
      hold,
      formatId: ship.formatId,
      formatChangeRequired: formatChangePending(
        ship.formatBridgeType,
        installedRows.find((part) => part.partCatalog.partClass === 'BRIDGE')?.partType ?? null,
      ),
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
        envFuelMult: Math.max(
          1,
          ...route.routeEnvironments.map((link) => link.environment.fuelMult),
        ),
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
  include: { format: { select: { cells: true; minBridgeSize: true } } };
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
