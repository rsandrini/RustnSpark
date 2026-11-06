import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Clock } from '../common/clock/clock.js';
import { jobDelayMs } from '../config/debug-timing.js';
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { RESCUE_BASE_TYPES } from '../ships/floating.js';
import { rawMobility } from '../ships/sheet.deriver.js';
import { ShipsService } from '../ships/ships.service.js';
import { ACTIVE_STATUSES } from '../missions/missions.service.js';
import { InventoryService } from './inventory.service.js';

export const ESCORT_EVENT = 'escort';

const MS_PER_SECOND = 1000;
const MS_PER_DAY = 86_400_000;
const ZERO = 0;

/** Why the escort cannot be called right now (one code per reason; the web says each in its own words). */
export type EscortReason =
  'SHIP_ADRIFT' | 'ACTIVE_MISSION_EXISTS' | 'ALREADY_SAFE' | 'NOT_STUCK' | 'COOLDOWN' | 'NO_PORT';

export interface EscortInfo {
  readonly shipId: string;
  /** `available`: the pilot may call it; `underway`: the transport is flying; `unavailable`: see `reasons`. */
  readonly state: 'available' | 'underway' | 'unavailable';
  readonly reasons: EscortReason[];
  /** The nearest port of the pilot's faction (any base when the faction has none in reach). */
  readonly destinationId: string | null;
  readonly distance: number | null;
  readonly durationSeconds: number | null;
  /** While underway: when the ship arrives. */
  readonly arrivesAt: string | null;
  /** When the cooldown ends (only while it is the reason). */
  readonly nextAvailableAt: string | null;
}

interface Edge {
  readonly nodeAId: string;
  readonly nodeBId: string;
  readonly distance: number;
}

/** Shortest route distance from `from` to every node (Dijkstra; the graph has tens of nodes). */
function distancesFrom(from: string, routes: readonly Edge[]): Map<string, number> {
  const best = new Map<string, number>([[from, ZERO]]);
  const open = new Set<string>([from]);
  while (open.size > ZERO) {
    let current: string | undefined;
    for (const id of open) {
      if (current === undefined || (best.get(id) ?? Infinity) < (best.get(current) ?? Infinity)) {
        current = id;
      }
    }
    if (current === undefined) break;
    open.delete(current);
    const here = best.get(current) ?? ZERO;
    for (const edge of routes) {
      const next =
        edge.nodeAId === current ? edge.nodeBId : edge.nodeBId === current ? edge.nodeAId : null;
      if (next === null) continue;
      const candidate = here + edge.distance;
      if (candidate < (best.get(next) ?? Infinity)) {
        best.set(next, candidate);
        open.add(next);
      }
    }
  }
  return best;
}

/**
 * The escort for a stuck pilot (owner, 2026-11-06): a ship that failed to get to a safe port, lost
 * parts and sits in debt where nothing can be bought or repaired is taken by an escort to the nearest
 * port of its faction. The pilot accepts and watches it: no fights, no damage, a slow fixed pace
 * (`economy.escort_seconds_per_distance`), free, and once per `economy.escort_cooldown_days`.
 * The ship is ON_MISSION meanwhile; on arrival it is docked at the port with the restart kit and a
 * small fuel ration, like a rescued ship.
 */
@Injectable()
export class EscortService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly events: PlayerEventService,
    private readonly inventory: InventoryService,
    private readonly ships: ShipsService,
    private readonly clock: Clock,
  ) {}

  /** What the escort offers now; a transport whose time is up arrives first. */
  async info(shipId: string, playerId: string): Promise<EscortInfo> {
    await this.settle(shipId, playerId);
    return this.evaluate(shipId, playerId);
  }

  /** The pilot accepts: the ship leaves for the safe port. */
  async start(shipId: string, playerId: string): Promise<EscortInfo> {
    const rules = this.config.snapshot().rules;
    const now = this.clock.now();
    await this.settle(shipId, playerId);
    const offer = await this.evaluate(shipId, playerId);
    if (
      offer.state !== 'available' ||
      offer.destinationId === null ||
      offer.durationSeconds === null
    ) {
      throw new ConflictException({ error: 'ESCORT_NOT_AVAILABLE', reasons: offer.reasons });
    }
    const destinationId = offer.destinationId;
    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { debugFastOps: true },
    });
    const delay = jobDelayMs(
      offer.durationSeconds * MS_PER_SECOND,
      rules,
      player?.debugFastOps ?? false,
    );
    const arrivesAt = new Date(now.getTime() + delay);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Ship" WHERE id = ${shipId} FOR UPDATE`;
      const ship = await tx.ship.findFirst({ where: { id: shipId, ownerPlayerId: playerId } });
      if (ship?.status !== 'IN_PORT')
        throw new ConflictException({ error: 'ESCORT_NOT_AVAILABLE' });
      await tx.ship.update({
        where: { id: shipId },
        data: { status: 'ON_MISSION', escortToId: destinationId, escortArrivesAt: arrivesAt },
      });
      await this.events.record(
        {
          playerId,
          type: ESCORT_EVENT,
          payload: { shipId, fromId: ship.currentLocationId, toId: destinationId },
        },
        tx,
      );
    });
    return this.evaluate(shipId, playerId);
  }

  /** Docks a ship whose escort has arrived (a no-op before that, or when none is underway). */
  async settle(shipId: string, playerId: string): Promise<void> {
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Ship" WHERE id = ${shipId} FOR UPDATE`;
      const ship = await tx.ship.findFirst({ where: { id: shipId, ownerPlayerId: playerId } });
      if (ship === null) throw new NotFoundException('ship not found');
      if (
        ship.escortToId === null ||
        ship.escortArrivesAt === null ||
        ship.escortArrivesAt.getTime() > now.getTime()
      ) {
        return;
      }
      await this.dock(tx, shipId, playerId, ship.escortToId);
    });
  }

  private async dock(
    tx: Prisma.TransactionClient,
    shipId: string,
    playerId: string,
    baseId: string,
  ): Promise<void> {
    const rules = this.config.snapshot().rules;
    await tx.ship.update({
      where: { id: shipId },
      data: {
        status: 'IN_PORT',
        currentLocationId: baseId,
        escortToId: null,
        escortArrivesAt: null,
        floatRouteId: null,
        floatFromId: null,
        floatProgress: null,
      },
    });
    // The same restart kit and fuel ration as a rescued ship: the pilot can leave in debt.
    const restart = await this.inventory.provideReplacements(tx, playerId, shipId);
    const ration = Math.round(restart.fuelCap * rules.economy.rescue_fuel_fraction);
    const held = await tx.ship.findUniqueOrThrow({ where: { id: shipId }, select: { fuel: true } });
    const fuel = Math.min(restart.fuelCap, Math.max(held.fuel, ration));
    if (fuel !== held.fuel) await tx.ship.update({ where: { id: shipId }, data: { fuel } });
  }

  private async evaluate(shipId: string, playerId: string): Promise<EscortInfo> {
    const rules = this.config.snapshot().rules;
    const now = this.clock.now();
    const ship = await this.prisma.ship.findFirst({
      where: { id: shipId, ownerPlayerId: playerId },
    });
    if (ship === null) throw new NotFoundException('ship not found');
    const base = {
      shipId,
      destinationId: null,
      distance: null,
      durationSeconds: null,
      arrivesAt: null,
      nextAvailableAt: null,
    };
    let nextAvailableAt: string | null = null;

    if (ship.escortToId !== null && ship.escortArrivesAt !== null) {
      return {
        ...base,
        state: 'underway',
        reasons: [],
        destinationId: ship.escortToId,
        arrivesAt: ship.escortArrivesAt.toISOString(),
      };
    }

    const reasons: EscortReason[] = [];
    if (ship.status === 'ADRIFT') reasons.push('SHIP_ADRIFT');
    const active = await this.prisma.missionInstance.count({
      where: { playerId, status: { in: [...ACTIVE_STATUSES] } },
    });
    if (active > ZERO || ship.status === 'ON_MISSION') reasons.push('ACTIVE_MISSION_EXISTS');

    const [player, places, routes, last] = await Promise.all([
      this.prisma.player.findUniqueOrThrow({
        where: { id: playerId },
        select: { credits: true, factionId: true },
      }),
      this.prisma.location.findMany({ select: { id: true, type: true, factionId: true } }),
      this.prisma.route.findMany({ select: { nodeAId: true, nodeBId: true, distance: true } }),
      this.prisma.playerEvent.findFirst({
        where: { playerId, type: ESCORT_EVENT },
        orderBy: { at: 'desc' },
        select: { at: true },
      }),
    ]);

    const here = places.find((place) => place.id === ship.currentLocationId);
    const isOwnPort = (place: { type: string; factionId: string }) =>
      RESCUE_BASE_TYPES.has(place.type) && place.factionId === player.factionId;
    if (here !== undefined && isOwnPort(here)) reasons.push('ALREADY_SAFE');

    // Stuck: in debt (nothing can be bought or repaired) or a ship that cannot fly at all.
    const sheet = (await this.ships.findById(shipId)).sheet;
    const cannotFly =
      sheet.structureBudget <= ZERO ||
      sheet.pot <= ZERO ||
      rawMobility(sheet.pot, sheet.mass, rules) < 1 ||
      (sheet.fuelUse > ZERO && ship.fuel <= ZERO);
    if (player.credits >= ZERO && !cannotFly && !reasons.includes('ALREADY_SAFE')) {
      reasons.push('NOT_STUCK');
    }

    const cooldownMs = rules.economy.escort_cooldown_days * MS_PER_DAY;
    if (last !== null && cooldownMs > ZERO) {
      const next = last.at.getTime() + cooldownMs;
      if (next > now.getTime()) {
        reasons.push('COOLDOWN');
        nextAvailableAt = new Date(next).toISOString();
      }
    }

    const distances = distancesFrom(ship.currentLocationId, routes);
    const nearest = (ports: typeof places) =>
      ports
        .filter((place) => distances.has(place.id))
        .reduce<{ id: string; distance: number } | null>((best, place) => {
          const distance = distances.get(place.id) ?? Infinity;
          return best === null || distance < best.distance ? { id: place.id, distance } : best;
        }, null);
    const target =
      nearest(places.filter(isOwnPort)) ??
      nearest(places.filter((place) => RESCUE_BASE_TYPES.has(place.type)));
    if (target === null) reasons.push('NO_PORT');

    return {
      ...base,
      state: reasons.length === ZERO ? 'available' : 'unavailable',
      reasons,
      destinationId: target?.id ?? null,
      distance: target?.distance ?? null,
      durationSeconds:
        target === null
          ? null
          : Math.max(1, Math.round(target.distance * rules.economy.escort_seconds_per_distance)),
      nextAvailableAt,
    };
  }
}
