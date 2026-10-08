import type { Prisma } from '@prisma/client';
import { toJsonInput } from '../common/prisma-json.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { rollConnectors, type ConnectorCell } from '../parts/connectors.js';
import { localize } from '../common/i18n/localize.js';
import { bilingual, pickCatalogStats } from '../parts/parts.service.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { InsufficientFundsError, WalletService } from '../players/wallet.service.js';
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Clock } from '../common/clock/clock.js';
import { inStockToday } from './market-stock.js';
import { PricingService } from './pricing.service.js';
import {
  catalogConnectorSeed,
  catalogListingId,
  dayKey,
  parseListingId,
  USED_OFFER_COUNT,
  usedConnectorSeed,
  usedListingId,
  usedOffer,
} from './used-offers.js';

export const MARKET_BUY_EVENT = 'market.buy';
export const MARKET_SELL_EVENT = 'market.sell';

export interface MarketListing {
  readonly listingId: string;
  readonly kind: 'catalog' | 'used';
  readonly partType: string;
  readonly partClass: string;
  readonly displayName: { en: string; 'pt-BR': string };
  readonly description: { en: string; 'pt-BR': string };
  readonly rarity: string;
  readonly catalog: ReturnType<typeof pickCatalogStats>;
  readonly condition: number;
  readonly price: number;
  /** The part's concrete connector cells — generated, fixed, and exactly what a buyer receives.
      Empty = no layout (universal fallback). */
  readonly connectors: readonly ConnectorCell[];
}

/** What this port pays for one of the player's uninstalled parts (S10.9). */
export interface SellOffer {
  readonly partInstanceId: string;
  readonly price: number;
}

export interface MarketResponse {
  readonly locationId: string;
  readonly listings: readonly MarketListing[];
  /**
   * The port's quote for each of the player's inventory parts, priced by the same
   * function `sell` re-derives — so the client sends a real `expectedPrice` on the first
   * try instead of learning it from a PRICE_CHANGED round trip.
   */
  readonly sellOffers: readonly SellOffer[];
  /** Parts below this condition (%) are refused at every port. */
  readonly sellMinCondition: number;
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

@Injectable()
export class MarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly wallet: WalletService,
    private readonly events: PlayerEventService,
    private readonly clock: Clock,
    private readonly config: GameConfigService,
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
    const day = dayKey(this.clock.now());
    const rarityChance = this.config.snapshot().rules.economy.market_rarity_chance;

    // Round-5/6 backlog: rare+ parts are meant to be scarce or absent from the market (drops/the
    // upgrade mechanic instead) — each catalog row rolls, once per port per day, whether it's
    // actually on the shelf, deterministically (buy() re-derives the same roll, never trusts the
    // client's listingId alone). Applies to BOTH shelves: the used shelf's own random slots must
    // draw from this same in-stock pool, not the full catalog, or a rarity excluded from "new"
    // listings could still turn up used (owner report, round 6 — this is exactly what happened
    // before this fix).
    const inStockCatalogs = catalogs.filter((row) =>
      inStockToday(locationId, day, row.partType, row.rarity, rarityChance),
    );
    const listings: MarketListing[] = inStockCatalogs.map((row) => ({
      listingId: catalogListingId(locationId, row.partType),
      kind: 'catalog' as const,
      partType: row.partType,
      partClass: row.partClass,
      displayName: {
        en: localize(row.displayName, 'en'),
        'pt-BR': localize(row.displayName, 'pt-BR'),
      },
      description: bilingual(row.description),
      rarity: row.rarity,
      catalog: pickCatalogStats(row),
      condition: 100,
      price: this.pricing.buy(context, row, 100),
      connectors: rollConnectors(row, catalogConnectorSeed(locationId, day, row.partType))?.cells ?? [],
    }));

    for (let index = 0; index < USED_OFFER_COUNT; index += 1) {
      const { condition, part: partRow } = usedOffer(locationId, day, index, inStockCatalogs);
      if (!partRow) continue;
      listings.push({
        listingId: usedListingId(locationId, day, index, partRow.partType),
        kind: 'used',
        partType: partRow.partType,
        partClass: partRow.partClass,
        displayName: {
          en: localize(partRow.displayName, 'en'),
          'pt-BR': localize(partRow.displayName, 'pt-BR'),
        },
        description: bilingual(partRow.description),
        rarity: partRow.rarity,
        catalog: pickCatalogStats(partRow),
        condition,
        price: this.pricing.buy(context, partRow, condition),
        connectors: rollConnectors(partRow, usedConnectorSeed(locationId, day, index))?.cells ?? [],
      });
    }

    const sold = await this.soldListingIds(listings.map((l) => l.listingId));
    const shelf = listings.filter((l) => !sold.has(l.listingId));

    const owned = await this.prisma.partInstance.findMany({
      where: { ownerPlayerId: playerId, location: 'INVENTORY' },
      include: { partCatalog: { select: { basePrice: true } } },
      orderBy: { id: 'asc' },
    });
    const sellMinCondition = this.config.snapshot().rules.economy.sell_min_condition;
    const sellOffers = owned
      // A part too damaged to sell gets no quote: the port never takes it, not even for nothing.
      .filter((part) => part.condition >= sellMinCondition)
      .map((part) => ({
        partInstanceId: part.id,
        price: this.pricing.sell(context, part, { basePrice: part.partCatalog.basePrice }),
      }));

    return { locationId, listings: shelf, sellOffers, sellMinCondition };
  }

  /** Which of these listings already have a purchase on record today (any player). Every listing
      is one physical item per port per day: a "catalog" id carries no day, so only purchases since
      the start of the current UTC day count — the shelf restocks at the day roll. */
  private async soldListingIds(
    listingIds: readonly string[],
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Set<string>> {
    if (listingIds.length === 0) return new Set();
    const since = new Date(`${dayKey(this.clock.now())}T00:00:00.000Z`);
    const rows = await tx.playerEvent.findMany({
      where: {
        type: MARKET_BUY_EVENT,
        at: { gte: since },
        OR: listingIds.map((id) => ({ payload: { path: ['listingId'], equals: id } })),
      },
      select: { payload: true },
    });
    return new Set(rows.map((row) => (row.payload as { listingId: string }).listingId));
  }

  async buy(playerId: string, listingId: string, expectedPrice: number): Promise<BuyResponse> {
    const parsed = parseListingId(listingId);
    if (!parsed) throw new BadRequestException({ error: 'INVALID_LISTING' });
    // The used shelf is the board's day roll: market() stamps today's UTC day into every
    // used listing id, so buy() accepts only that day. A listing minted yesterday is stale
    // (and a forged day would hand-build conditions the board never showed). A roll-over
    // between listing and purchase fails the same way — re-open the board.
    if (parsed.kind === 'used' && parsed.day !== dayKey(this.clock.now())) {
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
    // Same re-derivation as the used-shelf day check above: a "catalog" listing id carries no
    // day itself (it's stable so it can be bookmarked/priced client-side), so buy() re-rolls
    // today's stock the same way market() did when it built the list — a client can't buy a
    // rarity that was never actually on the shelf just by knowing its listingId shape.
    if (parsed.kind === 'catalog') {
      const rarityChance = this.config.snapshot().rules.economy.market_rarity_chance;
      if (!inStockToday(parsed.locationId, dayKey(this.clock.now()), catalog.partType, catalog.rarity, rarityChance)) {
        throw new BadRequestException({ error: 'INVALID_LISTING' });
      }
    }

    let condition = 100;
    // Same seed market() used for this listing, so the stored layout is the one shown.
    let connectorSeed = catalogConnectorSeed(
      parsed.locationId,
      dayKey(this.clock.now()),
      parsed.partType,
    );
    if (parsed.kind === 'used') {
      connectorSeed = usedConnectorSeed(parsed.locationId, parsed.day!, parsed.index!);
      const catalogs = await this.prisma.partCatalog.findMany({
        where: { active: true },
        orderBy: { partType: 'asc' },
      });
      // Must match market()'s own pool exactly (same filter, same order) — usedOffer() picks by
      // index into this array, so a different pool size here would resolve a different part
      // than what the board actually showed for the same index.
      const rarityChance = this.config.snapshot().rules.economy.market_rarity_chance;
      const inStockCatalogs = catalogs.filter((row) =>
        inStockToday(parsed.locationId, parsed.day!, row.partType, row.rarity, rarityChance),
      );
      const offer = usedOffer(parsed.locationId, parsed.day!, parsed.index!, inStockCatalogs);
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
        // A listing is one physical item (new or used): the first buyer takes it off the shelf
        // for the day. The lock serializes two buyers of the same listing; the second sees the sale.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${listingId}::text))::text`;
        if ((await this.soldListingIds([listingId], tx)).size > 0) {
          throw new ConflictException({ error: 'LISTING_SOLD' });
        }
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
            connectors: toJsonInput(rollConnectors(catalog, connectorSeed)),
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
    if (part.condition < this.config.snapshot().rules.economy.sell_min_condition) {
      throw new ConflictException({ error: 'TOO_DAMAGED_TO_SELL' });
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
      await this.wallet.credit(playerId, freshPrice, `${MARKET_SELL_EVENT}:${partInstanceId}`, tx);
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
