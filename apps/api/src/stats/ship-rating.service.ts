import { Injectable } from '@nestjs/common';
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { rawMobility } from '../ships/sheet.deriver.js';
import { ShipsService } from '../ships/ships.service.js';

/** Snapshots each pilot's ship for the power and speed boards. Run on demand now, scheduled later. */
@Injectable()
export class ShipRatingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ships: ShipsService,
    private readonly config: GameConfigService,
  ) {}

  /** Rates the ship of every pilot who has one; returns how many were rated. */
  async refreshAll(): Promise<number> {
    const owners = await this.prisma.ship.findMany({
      distinct: ['ownerPlayerId'],
      select: { ownerPlayerId: true },
    });
    let rated = 0;
    for (const { ownerPlayerId } of owners) {
      if (await this.refresh(ownerPlayerId)) rated += 1;
    }
    return rated;
  }

  /** Rates one pilot's ship from its connected parts; false when the pilot has no ship. */
  async refresh(playerId: string): Promise<boolean> {
    const [ship] = await this.ships.findByPlayer(playerId);
    if (ship === undefined) return false;
    const { sheet } = ship;
    const rules = this.config.snapshot().rules;
    const data = {
      shipId: ship.id,
      power: sheet.pot,
      speed: rawMobility(sheet.pot, sheet.mass, rules),
      firepower: sheet.pdf,
      armor: sheet.bli,
      ratedAt: new Date(),
    };
    await this.prisma.shipRating.upsert({
      where: { playerId },
      create: { playerId, ...data },
      update: data,
    });
    return true;
  }
}
