import { toJsonInput } from '../common/prisma-json.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { WalletService } from './wallet.service.js';
import { ShipsService } from '../ships/ships.service.js';
import { pickCatalogStats } from '../parts/parts.service.js';
import { autoLayout } from '../ships/auto-layout.js';
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

    const starterParts = rules.onboarding.starter_parts as string[];
    const condition = rules.parts.starter_condition;
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

      const instances = await Promise.all(
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
      const layout = autoLayout(installedParts, catalogMap);
      if (layout.length !== installedParts.length) {
        throw new ConflictException({ error: 'AUTO_LAYOUT_OMITTED_PARTS' });
      }

      const sheet = deriveSheet(installedParts, rules);
      const { viable, problems } = checkViability(sheet, installedParts, rules);
      if (!viable) {
        throw new ConflictException({ error: 'SHIP_NOT_VIABLE', problems });
      }

      for (const placement of layout) {
        await tx.partInstance.update({
          where: { id: placement.partInstanceId },
          data: { location: 'INSTALLED', shipId: created.id },
        });
      }

      const filled = await tx.ship.update({
        where: { id: created.id },
        data: { layout: toJsonInput(layout), fuel: sheet.fuelCap },
      });

      await this.walletService.credit(playerId, startCredits, ONBOARDING_REASON, tx);

      return { shipId: filled.id };
    });

    return this.shipsService.findById(outcome.shipId);
  }
}
