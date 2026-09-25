import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { localize } from '../common/i18n/localize.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { MAX_CREDITS, WalletService } from '../players/wallet.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PricingService } from './pricing.service.js';

export const MATERIAL_SELL_EVENT = 'market.sell_material';

const ZERO = 0;

export interface MaterialHoldingResponse {
  readonly materialId: string;
  readonly displayName: { en: string; 'pt-BR': string };
  readonly rarity: string;
  readonly quantity: number;
  readonly unitPrice: number;
}

export interface MaterialsResponse {
  readonly locationId: string;
  readonly materials: readonly MaterialHoldingResponse[];
}

export interface SellMaterialResponse {
  readonly materialId: string;
  readonly quantity: number;
  readonly price: number;
  readonly credits: number;
}

/**
 * S8.7: the materials side of the trade loop (GDD §13). Mined ore is credited to
 * `PlayerMaterial` by mission resolution; here it is listed with its local sell price
 * (`basePrice × isolation × faction × mood × sell_ratio`) and sold back to the port.
 * Selling is always allowed — even from a negative balance (GDD §14 blocks buying
 * only — "cava e sai cavando" is exactly this escape hatch).
 */
@Injectable()
export class MaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly wallet: WalletService,
    private readonly events: PlayerEventService,
  ) {}

  async list(playerId: string): Promise<MaterialsResponse> {
    const context = await this.pricing.contextForPlayer(playerId);
    const rows = await this.prisma.playerMaterial.findMany({
      where: { playerId, quantity: { gt: ZERO } },
      include: { material: true },
      orderBy: { materialId: 'asc' },
    });
    return {
      locationId: context.location.id,
      materials: rows.map((row) => ({
        materialId: row.materialId,
        displayName: {
          en: localize(row.material.displayName, 'en'),
          'pt-BR': localize(row.material.displayName, 'pt-BR'),
        },
        rarity: row.material.rarity,
        quantity: row.quantity,
        unitPrice: this.pricing.sellMaterial(context, row.material),
      })),
    };
  }

  async sell(
    playerId: string,
    materialId: string,
    quantity: number,
    expectedPrice: number,
  ): Promise<SellMaterialResponse> {
    if (!Number.isInteger(quantity) || quantity <= ZERO) {
      throw new BadRequestException({ error: 'INVALID_QUANTITY' });
    }
    const material = await this.prisma.material.findUnique({ where: { id: materialId } });
    if (!material) throw new NotFoundException('material not found');

    // GDD §13: trade is a port action. Pricing follows this ship's current port, so
    // "the ship sells where it is docked" holds by construction; what has to be gated is
    // the ship being away — a ship in transit trades nothing (S7.7 lock family, now
    // covering sales of materials as well as parts). ADRIFT and IN_PORT both trade.
    const ship = await this.prisma.ship.findFirst({
      where: { ownerPlayerId: playerId },
      orderBy: { id: 'asc' },
      select: { id: true, status: true, currentLocationId: true },
    });
    if (!ship) throw new NotFoundException('player has no ship');
    if (ship.status === 'ON_MISSION') {
      throw new ConflictException({ error: 'SHIP_ON_MISSION' });
    }
    const context = await this.pricing.contextForLocation(ship.currentLocationId, playerId);
    const unitPrice = this.pricing.sellMaterial(context, material);
    const price = unitPrice * quantity;
    // The stack is int4 and the credit lands in an int4 balance: a sale whose total
    // overflows either of them must fail as a domain conflict, never as a 500 from the
    // wallet's overflow guard deep inside the transaction.
    if (!Number.isSafeInteger(price) || price > MAX_CREDITS) {
      throw new ConflictException({ error: 'CREDIT_OVERFLOW', max: MAX_CREDITS });
    }
    // Stale-price guard only: the server always sells at its own recomputed price.
    if (price !== expectedPrice) {
      throw new ConflictException({ error: 'PRICE_CHANGED', actual: price });
    }

    const credits = await this.prisma.$transaction(async (tx) => {
      // Single conditional UPDATE (same shape as the wallet): two concurrent sales of
      // the same stack serialize on the row, and only `floor(held/quantity)` of them
      // can pass the `quantity >=` predicate.
      const remaining = await tx.$queryRaw<Array<{ quantity: number }>>`
        UPDATE "PlayerMaterial" SET quantity = quantity - ${quantity}
        WHERE "playerId" = ${playerId} AND "materialId" = ${materialId}
          AND quantity >= ${quantity}
        RETURNING quantity
      `;
      const left = remaining[0]?.quantity;
      if (left === undefined) {
        const held = await tx.playerMaterial.findUnique({
          where: { playerId_materialId: { playerId, materialId } },
          select: { quantity: true },
        });
        throw new BadRequestException({
          error: 'INSUFFICIENT_MATERIALS',
          held: held?.quantity ?? ZERO,
        });
      }
      if (left === ZERO) {
        await tx.playerMaterial.delete({
          where: { playerId_materialId: { playerId, materialId } },
        });
      }

      await this.wallet.credit(playerId, price, `${MATERIAL_SELL_EVENT}:${materialId}`, tx);
      await this.events.record(
        {
          playerId,
          type: MATERIAL_SELL_EVENT,
          payload: { materialId, quantity, unitPrice, price },
        },
        tx,
      );
      const after = await tx.player.findUniqueOrThrow({
        where: { id: playerId },
        select: { credits: true },
      });
      return after.credits;
    });

    return { materialId, quantity, price, credits };
  }
}
