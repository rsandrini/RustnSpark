import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { GameRules } from '../config/game-config.types.js';
import { toJsonInput } from '../common/prisma-json.js';
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from './wallet.service.js';
import { ShipsService } from '../ships/ships.service.js';
import type { ConnectorLayout } from '../parts/connectors.js';
import { pickCatalogStats } from '../parts/parts.service.js';
import { rollConnectorsForPartType } from '../parts/roll-connectors-for-part-type.js';
import { autoLayout } from '../ships/auto-layout.js';
import { applyConnectivity } from '../ships/connectivity.js';
import { CLASSIC_SQUARE_CELLS, connectedPartIds } from '../ships/geometry.js';
import { deriveSheet } from '../ships/sheet.deriver.js';
import { checkViability } from '../ships/viability.js';

const ONBOARDING_REASON = 'onboarding starter credits';

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: GameConfigService,
    private readonly shipsService: ShipsService,
    private readonly walletService: WalletService,
  ) {}

  async onboard(playerId: string, faction: string) {
    const rules = this.configService.snapshot().rules;
    const homeLocations = rules.onboarding.home_locations as Record<string, string>;
    const locationId = Object.hasOwn(homeLocations, faction) ? homeLocations[faction] : undefined;
    if (!locationId) {
      throw new BadRequestException({
        error: 'UNKNOWN_FACTION',
        message: 'faction is not playable',
      });
    }

    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      include: { ships: { select: { id: true }, orderBy: { id: 'asc' }, take: 1 } },
    });
    if (!player) throw new NotFoundException('player not found');

    if (player.factionId && player.factionId !== faction) {
      throw new ConflictException(`player has already chosen faction ${player.factionId}`);
    }

    const existing = player.ships[0];
    if (existing) {
      return this.shipsService.findById(existing.id);
    }

    const startCredits = rules.economy.start_credits;

    const outcome = await this.prisma.$transaction(async (tx) => {
      // The schema allows N ships per player, so single-shot onboarding is enforced by
      // serializing on the player row and re-checking inside the transaction.
      await tx.$queryRaw`SELECT id FROM "Player" WHERE id = ${playerId} FOR UPDATE`;
      const already = await tx.ship.findFirst({
        where: { ownerPlayerId: playerId },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      if (already) {
        return { shipId: already.id };
      }

      const created = await tx.ship.create({
        data: {
          ownerPlayerId: playerId,
          name: `${faction} starter`,
          layout: [],
          fuel: 0,
          status: 'IN_PORT',
          currentLocationId: locationId,
          stance: 'NEUTRAL',
        },
      });

      await tx.player.update({ where: { id: playerId }, data: { factionId: faction } });

      await this.applyStarterKit(tx, playerId, created.id, rules);

      await this.walletService.credit(playerId, startCredits, ONBOARDING_REASON, tx);

      return { shipId: created.id };
    });

    return this.shipsService.findById(outcome.shipId);
  }

  /**
   * The starter loadout: create `onboarding.starter_parts` in INVENTORY (uninstalled, D44),
   * verify the kit is viable when assembled, and fill the tank. Extracted from `onboard`
   * so the S11.4 support reset can re-kit an existing hull with the exact same proven
   * path (and the same conflict errors) instead of a second implementation.
   */
  async applyStarterKit(
    tx: Prisma.TransactionClient,
    playerId: string,
    shipId: string,
    rules: GameRules,
  ): Promise<void> {
    const starterParts = rules.onboarding.starter_parts as string[];
    const condition = rules.parts.starter_condition;

    const instances = await Promise.all(
      starterParts.map(async (partType) =>
        tx.partInstance.create({
          data: {
            partType,
            ownerPlayerId: playerId,
            condition,
            location: 'INVENTORY',
            connectors: toJsonInput(await rollConnectorsForPartType(tx, partType)),
          },
        }),
      ),
    );

    const partsWithCatalog = await tx.partInstance.findMany({
      where: { id: { in: instances.map((i) => i.id) } },
      include: { partCatalog: true },
      orderBy: { id: 'asc' },
    });

    const installedParts = partsWithCatalog.map((part) => ({
      instance: part,
      catalog: pickCatalogStats(part.partCatalog),
    }));

    const catalogMap = new Map(installedParts.map((p) => [p.instance.id, p.catalog]));
    const layout = autoLayout(installedParts, catalogMap, CLASSIC_SQUARE_CELLS);
    if (layout.length !== installedParts.length) {
      throw new ConflictException({ error: 'AUTO_LAYOUT_OMITTED_PARTS' });
    }

    const connectorsByInstance = new Map(
      partsWithCatalog.map((p) => [p.id, p.connectors as ConnectorLayout | null]),
    );
    const connectedIds = connectedPartIds(layout, catalogMap, connectorsByInstance);
    const installedConnected = applyConnectivity(installedParts, connectedIds);
    const sheet = deriveSheet(installedConnected, rules);
    const { viable, problems } = checkViability(sheet, installedConnected, rules);
    if (!viable) {
      throw new ConflictException({ error: 'SHIP_NOT_VIABLE', problems });
    }

    // The kit arrives as loose parts (D44): the player assembles the ship in the Hangar. The
    // auto-layout above only proves the kit *can* fly; nothing is installed here. The tank is
    // filled for the kit's capacity so the ship is ready the moment it is assembled.
    await tx.ship.update({
      where: { id: shipId },
      data: { layout: [], fuel: sheet.fuelCap },
    });
  }
}
