import { toJsonInput } from '../common/prisma-json.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { localize } from '../common/i18n/localize.js';
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

// The day's shelf: condition (already within the 40–90 band) and part for slot `index`.
// market() lists it and buy() re-derives it, so both must read this one function or the
// listed price and the charged price can drift apart.
function usedOffer<T>(
  locationId: string,
  day: string,
  index: number,
  catalogs: readonly T[],
): { condition: number; part: T | undefined } {
  const roll = stableUnit(`${locationId}:${day}:${index}`);
  const condition = Math.min(
    USED_CONDITION_MAX,
    Math.floor(USED_CONDITION_MIN + roll * (USED_CONDITION_MAX - USED_CONDITION_MIN + 1)),
  );
  const part =
    catalogs[Math.floor(stableUnit(`part:${locationId}:${day}:${index}`) * catalogs.length)];
  return { condition, part };
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
    const index = Number(used.groups['index']);
    // Only the six offers the board actually shows exist. Without this bound a client
    // could enumerate any date-shaped day and any index to mint arbitrary
    // (condition, partType) combinations that were never listed.
    if (!Number.isSafeInteger(index) || index < 0 || index >= USED_OFFER_COUNT) {
      return null;
    }
    return {
      kind: 'used',
      locationId: used.groups['locationId']!,
      day: used.groups['day']!,
      index,
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
  // Returns the ship so a trade POST can additionally apply the in-transit lock; a GET
  // (browsing the board) only needs the presence check.
  private async assertShipAtLocation(
    playerId: string,
    locationId: string,
  ): Promise<{ id: string; status: string }> {
    const ship = await this.prisma.ship.findFirst({
      where: { ownerPlayerId: playerId, currentLocationId: locationId },
      select: { id: true, status: true },
    });
    if (!ship) {
      throw new ConflictException({ error: 'SHIP_NOT_AT_LOCATION' });
    }
    return ship;
  }

  // Trade POSTs are port actions: a ship in transit trades nothing (S7.7 lock family).
  // Reads stay open, and ADRIFT still trades — stripping installed parts off a drifting
  // hull is the designed path into the restart kit (inventory.service).
  private assertNotOnMission(ship: { status: string }): void {
    if (ship.status === 'ON_MISSION') {
      throw new ConflictException({ error: 'SHIP_ON_MISSION' });
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
      const { condition, part: partRow } = usedOffer(locationId, day, index, catalogs);
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
        condition,
        price: this.pricing.buy(context, partRow, condition),
      });
    }

    return { locationId, listings };
  }

  async buy(playerId: string, listingId: string, expectedPrice: number): Promise<BuyResponse> {
    const parsed = parseListingId(listingId);
    if (!parsed) throw new BadRequestException({ error: 'INVALID_LISTING' });
    // The used shelf is the board's day roll: market() stamps today's UTC day into every
    // used listing id, so buy() accepts only that day. A listing minted yesterday is stale
    // (and a forged day would hand-build conditions the board never showed). A roll-over
    // between listing and purchase fails the same way — re-open the board.
    if (parsed.kind === 'used' && parsed.day !== dayKey(new Date())) {
      throw new BadRequestException({ error: 'INVALID_LISTING' });
    }

    // Presence and the trade gate, in the order buy() has always applied them: the ship
    // must be docked at the listing's port, and a ship in transit trades nothing.
    const ship = await this.assertShipAtLocation(playerId, parsed.locationId);
    this.assertNotOnMission(ship);
    const context = await this.pricing.contextForLocation(parsed.locationId, playerId);
    const catalog = await this.prisma.partCatalog.findUnique({
      where: { partType: parsed.partType },
    });
    if (!catalog || !catalog.active) throw new NotFoundException('listing not found');

    let condition = 100;
    if (parsed.kind === 'used') {
      const catalogs = await this.prisma.partCatalog.findMany({
        where: { active: true },
        orderBy: { partType: 'asc' },
      });
      const offer = usedOffer(parsed.locationId, parsed.day!, parsed.index!, catalogs);
      if (!offer.part || offer.part.partType !== parsed.partType) {
        throw new NotFoundException('listing not found');
      }
      condition = offer.condition;
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

    // A ship in transit trades nothing (S7.7 lock family), and a sale is the port action
    // of the ship the price is quoted for. buy() asserts presence for an explicit
    // locationId; here the port comes from the same first ship contextForPlayer used to
    // fetch, so presence against its own currentLocationId and the ON_MISSION gate fall
    // out of one row. ADRIFT still trades — stripping a drifting hull is the designed
    // path into the restart kit (inventory.service's viability gate).
    const pricingShip = await this.prisma.ship.findFirst({
      where: { ownerPlayerId: playerId },
      orderBy: { id: 'asc' },
      select: { id: true, status: true, currentLocationId: true },
    });
    if (!pricingShip) throw new NotFoundException('player has no ship');
    await this.assertShipAtLocation(playerId, pricingShip.currentLocationId);
    this.assertNotOnMission(pricingShip);

    // Fast path before pricing so a mid-flight ship fails with SHIP_ON_MISSION (the
    // S7.7 lock error) rather than a stale-price 409; the locked re-check inside the
    // tx is what actually serializes against a concurrent dispatch. Same row as the
    // gate above in v0.1's single-ship world; kept for a part on another hull.
    if (part.location === 'INSTALLED' && part.shipId) {
      const installedOn = await this.prisma.ship.findUnique({
        where: { id: part.shipId },
        select: { status: true },
      });
      if (installedOn?.status === 'ON_MISSION') {
        throw new ConflictException({ error: 'SHIP_ON_MISSION' });
      }
    }

    const context = await this.pricing.contextForLocation(pricingShip.currentLocationId, playerId);
    const price = this.pricing.sell(context, part, { basePrice: part.partCatalog.basePrice });
    if (price !== expectedPrice) {
      throw new ConflictException({ error: 'PRICE_CHANGED', actual: price });
    }

    const credits = await this.prisma.$transaction(async (tx) => {
      // Lock discipline: Ship row first when a ship is involved (dispatch/repair/rescue
      // all take the Ship lock before touching parts), then the part row. The part is
      // re-read under its lock: a parallel sale of the same part sees the row gone and
      // 404s instead of blowing up on Prisma's P2025 → 500, and a layout, hull, or
      // condition that moved since the pre-tx read is re-priced and re-checked here
      // instead of being acted on stale.
      const preInstalled = part.location === 'INSTALLED' && part.shipId !== null;
      if (preInstalled && part.shipId) {
        await tx.$queryRaw`SELECT id FROM "Ship" WHERE id = ${part.shipId} FOR UPDATE`;
      }
      await tx.$queryRaw`SELECT id FROM "PartInstance" WHERE id = ${part.id} FOR UPDATE`;
      const fresh = await tx.partInstance.findUnique({
        where: { id: part.id },
        include: { partCatalog: true },
      });
      if (!fresh || fresh.ownerPlayerId !== playerId) {
        throw new NotFoundException('part not found');
      }
      if (fresh.location === 'INSTALLED' && fresh.shipId && fresh.shipId !== part.shipId) {
        // Fitted between the pre-read and the lock — the one path that moves an
        // inventory part onto a hull. Take that hull's lock too (after the part row;
        // the canonical Ship → Part order holds everywhere else) before editing it.
        await tx.$queryRaw`SELECT id FROM "Ship" WHERE id = ${fresh.shipId} FOR UPDATE`;
      }
      const freshPrice = this.pricing.sell(context, fresh, {
        basePrice: fresh.partCatalog.basePrice,
      });
      if (freshPrice !== expectedPrice) {
        throw new ConflictException({ error: 'PRICE_CHANGED', actual: freshPrice });
      }
      if (fresh.location === 'INSTALLED' && fresh.shipId) {
        const ship = await tx.ship.findUnique({ where: { id: fresh.shipId } });
        if (ship?.status === 'ON_MISSION') {
          throw new ConflictException({ error: 'SHIP_ON_MISSION' });
        }
        if (ship) {
          const layout = Array.isArray(ship.layout)
            ? (ship.layout as Array<{ partInstanceId?: string }>)
            : [];
          const nextLayout = layout.filter((placement) => placement.partInstanceId !== fresh.id);
          await tx.ship.update({
            where: { id: ship.id },
            data: { layout: toJsonInput(nextLayout) },
          });
        }
      }
      await tx.partInstance.delete({ where: { id: fresh.id } });
      await this.wallet.credit(
        playerId,
        freshPrice,
        `${MARKET_SELL_EVENT}:${partInstanceId}`,
        tx,
      );
      await this.events.record(
        {
          playerId,
          type: MARKET_SELL_EVENT,
          payload: {
            partInstanceId,
            partType: fresh.partType,
            price: freshPrice,
            condition: fresh.condition,
          },
        },
        tx,
      );
      const after = await tx.player.findUniqueOrThrow({
        where: { id: playerId },
        select: { credits: true },
      });
      return after.credits;
    });

    // On success freshPrice === price (the tx re-check threw otherwise), so the quoted
    // price is what was actually credited.
    return { partInstanceId, price, credits };
  }
}
