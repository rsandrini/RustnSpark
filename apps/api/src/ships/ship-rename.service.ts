import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GameConfigService } from '../config/game-config.service.js';
import { PlayerEventService } from '../players/player-event.service.js';
import { InsufficientFundsError, WalletService } from '../players/wallet.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { containsBlockedWord, isValidSuffix, shipNamePrefix, tidySuffix } from './ship-name.js';

export const SHIP_RENAMED_EVENT = 'ship.renamed';

export interface RenameQuote {
  /** The fixed start of the name, e.g. `LUN-`. */
  prefix: string;
  /** What a rename costs. */
  price: number;
  /** The ship's name now. */
  name: string;
}

@Injectable()
export class ShipRenameService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly wallet: WalletService,
    private readonly events: PlayerEventService,
  ) {}

  async quote(shipId: string, playerId: string): Promise<RenameQuote> {
    const { ship, factionId } = await this.owned(shipId, playerId);
    return {
      prefix: shipNamePrefix(factionId),
      price: this.config.snapshot().rules.economy.ship_rename_price,
      name: ship.name,
    };
  }

  async rename(shipId: string, playerId: string, raw: string): Promise<RenameQuote> {
    const { ship, factionId } = await this.owned(shipId, playerId);
    const rules = this.config.snapshot().rules;
    const suffix = tidySuffix(raw);
    if (!isValidSuffix(suffix)) throw new ConflictException({ error: 'SHIP_NAME_INVALID' });
    if (containsBlockedWord(suffix, rules.admin.name_blocklist)) {
      throw new ConflictException({ error: 'SHIP_NAME_BLOCKED' });
    }
    const prefix = shipNamePrefix(factionId);
    const name = `${prefix}${suffix}`;
    if (name === ship.name) throw new ConflictException({ error: 'SHIP_NAME_UNCHANGED' });

    const price = rules.economy.ship_rename_price;
    try {
      await this.prisma.$transaction(async (tx) => {
        if (price > 0) await this.wallet.debit(playerId, price, `ship.rename:${shipId}`, tx);
        await tx.ship.update({ where: { id: shipId }, data: { name } });
        await this.events.record(
          { playerId, type: SHIP_RENAMED_EVENT, payload: { shipId, from: ship.name, to: name } },
          tx,
        );
      });
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw new ConflictException({ error: 'INSUFFICIENT_FUNDS' });
      }
      throw error;
    }
    return { prefix, price, name };
  }

  private async owned(shipId: string, playerId: string) {
    const ship = await this.prisma.ship.findUnique({ where: { id: shipId } });
    if (ship === null || ship.ownerPlayerId !== playerId) {
      throw new NotFoundException('ship not found');
    }
    const player = await this.prisma.player.findUniqueOrThrow({
      where: { id: playerId },
      select: { factionId: true },
    });
    return { ship, factionId: player.factionId };
  }
}
