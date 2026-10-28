import { describe, expect, it, jest } from '@jest/globals';
import type { GameConfigService } from '../../../src/config/game-config.service.js';
import type { PrismaService } from '../../../src/prisma/prisma.service.js';
import type { ShipsService } from '../../../src/ships/ships.service.js';
import { ShipRatingService } from '../../../src/stats/ship-rating.service.js';

const rules = { ship: { mob_factor: 2 } };
const config = { snapshot: () => ({ rules }) } as unknown as GameConfigService;

function build(ships: { id: string; sheet: Record<string, number> }[]) {
  const upsert = jest.fn<(args: unknown) => Promise<object>>().mockResolvedValue({});
  const prisma = {
    ship: { findMany: () => Promise.resolve([{ ownerPlayerId: 'p1' }, { ownerPlayerId: 'p2' }]) },
    shipRating: { upsert },
  } as unknown as PrismaService;
  const findByPlayer = jest.fn((playerId: string) =>
    Promise.resolve(playerId === 'p1' ? ships : []),
  );
  const service = new ShipRatingService(
    prisma,
    { findByPlayer } as unknown as ShipsService,
    config,
  );
  return { service, upsert };
}

describe('ShipRatingService', () => {
  it('rates power as the sheet thrust and speed as unrounded mobility', async () => {
    const { service, upsert } = build([
      { id: 's1', sheet: { pot: 100, mass: 40, pdf: 7, bli: 3 } },
    ]);
    expect(await service.refresh('p1')).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { playerId: 'p1' },
        update: expect.objectContaining({
          shipId: 's1',
          power: 100,
          speed: 5, // 100 / 40 x mob_factor 2
          firepower: 7,
          armor: 3,
        }),
      }),
    );
  });

  it('rates a ship with no mass at speed 0 and skips a pilot with no ship', async () => {
    const { service, upsert } = build([{ id: 's1', sheet: { pot: 0, mass: 0, pdf: 0, bli: 0 } }]);
    expect(await service.refreshAll()).toBe(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0]![0]).toMatchObject({ update: { speed: 0 } });
  });
});
