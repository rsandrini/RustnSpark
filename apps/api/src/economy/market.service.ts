import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PlayerEventService } from '../players/player-event.service.js';
import { InsufficientFundsError, WalletService } from '../players/wallet.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { stableUnit } from './deterministic.js';
import { PricingService } from './pricing.service.js';

export const MARKET_BUY_EVENT = 'market.buy';
export const MARKET_SELL_EVENT = 'market.sell';

const USED_OFFER_COUNT = 6;
const USED_CONDITION_MIN = 40;
const USED_CONDITION_MAX = 90;
const DAY_KEY_LENGTH = 10;

export interface MarketListing {
  readonly listingId: string;
  readonly kind: 'catalog' | 'used';
  readonly partType: string;
  readonly partClass: string;
  readonly displayName: { en: string; 'pt-BR': string };
  readonly condition: number;
  readonly price: number;
}

export interface MarketResponse {
  readonly locationId: string;
  readonly listings: readonly MarketListing[];
}

export interface BuyResponse {
  readonly partInstanceId: string;
  readonly partType: string;
  readonly condition: number;
  readonly price: number;
  readonly credits: number;
}

export interface SellResponse {
  readonly partInstanceId: string;
  readonly price: number;
  readonly credits: number;
}

function dayKey(at: Date): string {
  return at.toISOString().slice(0, DAY_KEY_LENGTH);
}

function localize(value: unknown, locale = 'en'): string {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const candidate = record[locale] ?? record['en'];
    if (typeof candidate === 'string') return candidate;
  }
  return '';
}

function parseListingId(listingId: string): {
  kind: 'catalog' | 'used';
  locationId: string;
  partType: string;
  day?: string;
  index?: number;
} | null {
  const catalog = /^catalog:(?<locationId>[^:]+):(?<partType>.+)$/.exec(listingId);
  if (catalog?.groups) {
    return {
      kind: 'catalog',
      locationId: catalog.groups['locationId']!,
      partType: catalog.groups['partType']!,
    };
  }
  const used =
    /^used:(?<locationId>[^:]+):(?<day>\d{4}-\d{2}-\d{2}):(?<index>\d+):(?<partType>.+)$/.exec(
      listingId,
    );
  if (used?.groups) {
    return {
      kind: 'used',
      locationId: used.groups['locationId']!,
      day: used.groups['day']!,
      index: Number(used.groups['index']),
      partType: used.groups['partType']!,
    };
  }
  return null;
}

@Injectable()
export class MarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly wallet: WalletService,
    private readonly events: PlayerEventService,
  ) {}

  // GDD §13: the board and purchases are the port you are docked at — a ship mid-jump
  // cannot shop somewhere else. No ship owned → nothing to dock → same 409.
  private async assertShipAtLocation(playerId: string, locationId: string): Promise<void> {
    const ship = await this.prisma.ship.findFirst({
      where: { ownerPlayerId: playerId, currentLocationId: locationId },
      select: { id: true },
    });
    if (!ship) {
      throw new ConflictException({ error: 'SHIP_NOT_AT_LOCATION' });
    }
  }

  async market(locationId: string, playerId: string): Promise<MarketResponse> {
    await this.assertShipAtLocation(playerId, locationId);
    const context = await this.pricing.contextForLocation(locationId, playerId);
    const catalogs = await this.prisma.partCatalog.findMany({
      where: { active: true },
      orderBy: { partType: 'asc' },
    });
    const now = new Date();
    const day = dayKey(now);

    const listings: MarketListing[] = catalogs.map((row) => ({
      listingId: `catalog:${locationId}:${row.partType}`,
      kind: 'catalog' as const,
      partType: row.partType,
      partClass: row.partClass,
      displayName: {
        en: localize(row.displayName, 'en'),
        'pt-BR': localize(row.displayName, 'pt-BR'),
      },
      condition: 100,
      price: this.pricing.buy(context, row, 100),
    }));

    for (let index = 0; index < USED_OFFER_COUNT; index += 1) {
      const roll = stableUnit(`${locationId}:${day}:${index}`);
      const condition = Math.floor(
        USED_CONDITION_MIN + roll * (USED_CONDITION_MAX - USED_CONDITION_MIN + 1),
      );
      const partRow =
        catalogs[Math.floor(stableUnit(`part:${locationId}:${day}:${index}`) * catalogs.length)];
      if (!partRow) continue;
      listings.push({
        listingId: `used:${locationId}:${day}:${index}:${partRow.partType}`,
        kind: 'used',
        partType: partRow.partType,
        partClass: partRow.partClass,
        displayName: {
          en: localize(partRow.displayName, 'en'),
          'pt-BR': localize(partRow.displayName, 'pt-BR'),
        },
        condition: Math.min(condition, USED_CONDITION_MAX),
        price: this.pricing.buy(context, partRow, condition),
      });
    }

    return { locationId, listings };
  }

  async buy(playerId: string, listingId: string, expectedPrice: number): Promise<BuyResponse> {
    const parsed = parseListingId(listingId);
    if (!parsed) throw new BadRequestException({ error: 'INVALID_LISTING' });

    await this.assertShipAtLocation(playerId, parsed.locationId);
    const context = await this.pricing.contextForLocation(parsed.locationId, playerId);
    const catalog = await this.prisma.partCatalog.findUnique({
      where: { partType: parsed.partType },
    });
    if (!catalog || !catalog.active) throw new NotFoundException('listing not found');

    let condition = 100;
    if (parsed.kind === 'used') {
      const roll = stableUnit(`${parsed.locationId}:${parsed.day}:${parsed.index}`);
      condition = Math.min(
        USED_CONDITION_MAX,
        Math.floor(USED_CONDITION_MIN + roll * (USED_CONDITION_MAX - USED_CONDITION_MIN + 1)),
      );
      const partRoll = stableUnit(`part:${parsed.locationId}:${parsed.day}:${parsed.index}`);
      const catalogs = await this.prisma.partCatalog.findMany({
        where: { active: true },
        orderBy: { partType: 'asc' },
      });
      const selected = catalogs[Math.floor(partRoll * catalogs.length)];
      if (!selected || selected.partType !== parsed.partType) {
        throw new NotFoundException('listing not found');
      }
    }

    const price = this.pricing.buy(context, catalog, condition);
    if (price !== expectedPrice) {
      throw new ConflictException({ error: 'PRICE_CHANGED', actual: price });
    }

    try {
      const part = await this.prisma.$transaction(async (tx) => {
        const player = await tx.player.findUnique({
          where: { id: playerId },
          select: { credits: true },
        });
        if (player && player.credits < 0) {
          throw new ConflictException({ error: 'BALANCE_NEGATIVE' });
        }
        await this.wallet.debit(playerId, price, `${MARKET_BUY_EVENT}:${listingId}`, tx);
        const created = await tx.partInstance.create({
          data: {
            partType: catalog.partType,
            ownerPlayerId: playerId,
            condition,
            location: 'INVENTORY',
          },
        });
        await this.events.record(
          {
            playerId,
            type: MARKET_BUY_EVENT,
            payload: { listingId, partInstanceId: created.id, price, condition },
          },
          tx,
        );
        return created;
      });
      const after = await this.prisma.player.findUniqueOrThrow({
        where: { id: playerId },
        select: { credits: true },
      });
      return {
        partInstanceId: part.id,
        partType: part.partType,
        condition: part.condition,
        price,
        credits: after.credits,
      };
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new ConflictException({ error: 'INSUFFICIENT_FUNDS' });
      }
      throw error;
    }
  }

  async sell(
    playerId: string,
    partInstanceId: string,
    expectedPrice: number,
  ): Promise<SellResponse> {
    const part = await this.prisma.partInstance.findUnique({
      where: { id: partInstanceId },
      include: { partCatalog: true },
    });
    if (!part || part.ownerPlayerId !== playerId) {
      throw new NotFoundException('part not found');
    }

    // Fast path before pricing so a mid-flight ship fails with SHIP_ON_MISSION (the
    // S7.7 lock error) rather than a stale-price 409; the locked re-check inside the
    // tx is what actually serializes against a concurrent dispatch.
    if (part.location === 'INSTALLED' && part.shipId) {
      const ship = await this.prisma.ship.findUnique({
        where: { id: part.shipId },
        select: { status: true },
      });
      if (ship?.status === 'ON_MISSION') {
        throw new ConflictException({ error: 'SHIP_ON_MISSION' });
      }
    }

    const context = await this.pricing.contextForPlayer(playerId);
    const price = this.pricing.sell(context, part, { basePrice: part.partCatalog.basePrice });
    if (price !== expectedPrice) {
      throw new ConflictException({ error: 'PRICE_CHANGED', actual: price });
    }

    const credits = await this.prisma.$transaction(async (tx) => {
      if (part.location === 'INSTALLED' && part.shipId) {
        // Serialize against dispatch/repair: both lock the Ship row first, so a
        // dispatch that lands between the outer read and this tx still sees
        // ON_MISSION under the lock.
        await tx.$queryRaw`SELECT id FROM "Ship" WHERE id = ${part.shipId} FOR UPDATE`;
        const ship = await tx.ship.findUnique({ where: { id: part.shipId } });
        if (ship?.status === 'ON_MISSION') {
          throw new ConflictException({ error: 'SHIP_ON_MISSION' });
        }
        if (ship) {
          const layout = Array.isArray(ship.layout)
            ? (ship.layout as Array<{ partInstanceId?: string }>)
            : [];
          const nextLayout = layout.filter((placement) => placement.partInstanceId !== part.id);
          await tx.ship.update({
            where: { id: ship.id },
            data: { layout: nextLayout as unknown as never },
          });
        }
      }
      await tx.partInstance.delete({ where: { id: part.id } });
      await this.wallet.credit(playerId, price, `${MARKET_SELL_EVENT}:${partInstanceId}`, tx);
      await this.events.record(
        {
          playerId,
          type: MARKET_SELL_EVENT,
          payload: { partInstanceId, partType: part.partType, price, condition: part.condition },
        },
        tx,
      );
      const after = await tx.player.findUniqueOrThrow({
        where: { id: playerId },
        select: { credits: true },
      });
      return after.credits;
    });

    return { partInstanceId, price, credits };
  }
}
